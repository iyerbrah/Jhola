import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalogJson from "@/data/catalog.json";
import { CatalogSchema } from "@/lib/schema";
import { buildFromRows, COLUMNS, parseCsv, reportFor, toCsv, type Row } from "@/scripts/catalog/grocery";

const row = (over: Partial<Row> = {}): Row => ({
  id: "p001",
  name: "Taaza Toned Milk",
  brand: "Amul",
  category: "dairy",
  kind: "milk",
  pack_size: "500",
  unit: "ml",
  price: "28",
  in_stock: "true",
  diet: "veg|jain",
  contains: "dairy",
  labels: "",
  search_terms: "doodh|toned milk",
  description: "",
  ...over,
});
/** Three in-stock milks, so the kind has a choice. */
const milks = (): Row[] => [row(), row({ id: "p002", name: "Gold Full Cream Milk" }), row({ id: "p003", brand: "Mother Dairy", name: "Toned Milk" })];

describe("CSV parsing", () => {
  it("reads quoted cells with commas, quotes and newlines", () => {
    const [r] = parseCsv('id,name\np001,"Chips, ""Salted""\nBig"\n');
    expect(r).toEqual({ id: "p001", name: 'Chips, "Salted"\nBig' });
  });

  it("round-trips through toCsv", () => {
    const rows = [row({ name: 'Chips, "Salted"' })];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("ignores a spreadsheet's byte-order mark and blank lines", () => {
    expect(parseCsv("﻿id,name\n\np001,Milk\n\n")).toEqual([{ id: "p001", name: "Milk" }]);
  });
});

describe("buildFromRows", () => {
  it("turns rows into products: diet and labels become tags, empty cells are left out", () => {
    const { products, errors } = buildFromRows([...milks(), row({ id: "p004", labels: "organic", name: "Organic Cow Milk" })]);
    expect(errors).toEqual([]);
    expect(products[0]).toEqual({
      id: "p001",
      name: "Taaza Toned Milk",
      brand: "Amul",
      category: "dairy",
      sub_category: "milk",
      pack_size: 500,
      unit: "ml",
      price: 28,
      in_stock: true,
      tags: ["veg", "jain"],
      contains: ["dairy"],
      search_terms: ["doodh", "toned milk"],
    });
    expect(products[3].tags).toEqual(["veg", "jain", "organic"]);
    expect(CatalogSchema.parse(products)).toHaveLength(4);
  });

  it("gives new rows the next free ID, after retired ones", () => {
    const { rows, assigned, errors } = buildFromRows([...milks(), row({ id: "", name: "Cow Milk" })], ["p009"]);
    expect(errors).toEqual([]);
    expect(assigned).toEqual(["p010"]);
    expect(rows[3].id).toBe("p010");
  });

  it("refuses a retired or repeated ID", () => {
    const { errors } = buildFromRows([...milks(), row({ id: "p002", name: "Cow Milk" }), row({ id: "p009", name: "Slim Milk" })], ["p009"]);
    expect(errors).toEqual([expect.stringContaining("p002 is used twice"), expect.stringContaining("p009 belonged to a product that was removed")]);
  });

  it("lists every problem with its line, at once", () => {
    const { errors } = buildFromRows([
      ...milks(),
      row({ id: "p004", category: "snacks_and_more", unit: "kg", price: "28.5", in_stock: "yes", diet: "veg|halal", contains: "milk" }),
    ]);
    expect(errors.every((e) => e.startsWith("line 5 (p004"))).toBe(true);
    expect(errors.join("\n")).toMatch(/category "snacks_and_more"[\s\S]*unit "kg"[\s\S]*price "28.5"[\s\S]*in_stock "yes"[\s\S]*diet "halal"[\s\S]*contains "milk"/);
  });

  it("keeps diets honest: vegan and jain are veg, vegan has no dairy or egg, egg isn't veg", () => {
    const errs = (over: Partial<Row>) => buildFromRows([...milks(), row({ id: "p004", name: "Test", ...over })]).errors;
    expect(errs({ diet: "jain" })).toEqual([expect.stringContaining("also veg")]);
    expect(errs({ diet: "veg|vegan" })).toEqual([expect.stringContaining("can't contain dairy")]);
    expect(errs({ diet: "veg", contains: "egg" })).toEqual([expect.stringContaining("can't contain egg")]);
  });

  it("leaves diet and contains to food: soap is never vegetarian", () => {
    const soap = (over: Partial<Row>) => row({ id: "p004", name: "Soap", category: "personal_care", kind: "soap", diet: "", contains: "", ...over });
    const ok = buildFromRows([...milks(), soap({}), soap({ id: "p005", brand: "Dove" }), soap({ id: "p006", brand: "Lux" })]);
    expect(ok.errors).toEqual([]);
    expect(buildFromRows([...milks(), soap({ diet: "veg" })]).errors).toContainEqual(expect.stringContaining("diet is for food only"));
  });

  it("keeps one category per kind", () => {
    const { errors } = buildFromRows([...milks(), row({ id: "p004", name: "Milk Bread", category: "bakery" })]);
    expect(errors).toContainEqual(expect.stringContaining("kind milk is dairy on line 2, not bakery"));
  });

  it("refuses the same product twice", () => {
    const { errors } = buildFromRows([...milks(), row({ id: "p004" })]);
    expect(errors).toContainEqual(expect.stringContaining("same brand, name and size as line 2"));
  });

  it("needs three products in stock for every kind", () => {
    const { errors } = buildFromRows([row(), row({ id: "p002", name: "Cow Milk", in_stock: "false" })]);
    expect(errors).toEqual(["kind milk: 1 in stock, needs at least 3 (add products or mark more in stock)"]);
  });

  it("reports a missing column instead of guessing", () => {
    const { errors } = buildFromRows([{ id: "p001", name: "Milk" }]);
    expect(errors[0]).toMatch(/^missing columns: brand, category/);
  });
});

describe("data/grocery.csv", () => {
  const csv = fs.readFileSync(path.join(__dirname, "../data/grocery.csv"), "utf8");
  const retired: string[] = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/catalog/retired-ids.json"), "utf8"));
  const built = buildFromRows(parseCsv(csv), retired);

  it("has the standard columns and passes every check", () => {
    expect(csv.split("\n")[0]).toBe(COLUMNS.join(","));
    expect(built.errors).toEqual([]);
    expect(built.assigned).toEqual([]);
  });

  it("matches data/catalog.json: run npm run catalog:build after editing the CSV", () => {
    expect(built.products).toEqual(CatalogSchema.parse(catalogJson));
  });

  it("matches the report the site reads its counts from", () => {
    const report = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/catalog/report.json"), "utf8"));
    expect(report).toEqual(reportFor(built.products));
  });
});
