import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalogJson from "@/data/catalog.json";
import ledgerJson from "@/data/catalog/ids.json";
import agentCarts from "@/evals/agent/carts.json";
import { buildCatalog, parseCsv, parseSize, type Row } from "@/scripts/catalog/build";
import { CatalogSchema, isFood, type Product } from "@/lib/schema";

// Real BigBasket rows, picked because each one was misfiled or is a case the pipeline must handle.
const rows = parseCsv(fs.readFileSync(path.join(__dirname, "fixtures/bigbasket-sample.csv"), "utf8")) as unknown as Row[];
const build = (r: Row[] = rows, ledger: Record<string, string> | null = {}, previous: Product[] = []) => buildCatalog({ rows: r, supplement: [], ledger, previous });
const find = (catalog: Product[], name: string) => {
  const p = catalog.find((x) => x.name.startsWith(name));
  if (!p) throw new Error(`${name} isn't in the catalog`);
  return p;
};

describe("catalog pipeline: kinds", () => {
  const { catalog } = build();

  it.each([
    ["Palakkad Red Matta Boiled Rice", "atta_rice_dal", "rice"], // was spinach ("palak" inside "Palakkad")
    ["Idli Rice", "atta_rice_dal", "idli_rice"], // was a beverage ("steam" contains "tea")
    ["Chicken Seekh Kabab Malai N Cheese", "eggs_meat", "ready_to_cook_meat"], // was cheese; not a plain cut either
    ["Rice - Flour", "atta_rice_dal", "flour"], // was rice
    ["Paneer - Premium Fresh", "dairy", "paneer"],
  ])("%s is %s / %s", (name, category, kind) => {
    expect(find(catalog, name)).toMatchObject({ category, sub_category: kind });
  });

  it.each([
    ["Besan Laddoo", "ghee"],
    ["Whole Wheat Khakhra", "ghee"],
    ["Dreams Cup Cake", "butter"],
    ["Indian Wheat Cracker", "cumin"],
  ])("%s isn't filed as the ingredient in its name (%s)", (name, wrong) => {
    expect(find(catalog, name).sub_category).not.toBe(wrong);
  });

  it("files non-food under its own categories, with no diet tags", () => {
    expect(find(catalog, "Original Bathing Bar Soap")).toMatchObject({ category: "personal_care", sub_category: "soap", tags: [] });
    expect(find(catalog, "Matic Top Load Detergent Powder")).toMatchObject({ category: "cleaning_household", sub_category: "detergent", tags: [] });
    expect(find(catalog, "Dry Pet Food")).toMatchObject({ category: "pet_care", sub_category: "dog_food", tags: [] });
    expect(find(catalog, "Paneer - Premium Fresh").tags).toContain("veg");
  });

  it("drops medicine, combos and multipacks, and counts why", () => {
    const { report } = build();
    expect(catalog.some((p) => /pain relief|deodorant/i.test(p.name))).toBe(false);
    expect(report.dropped).toMatchObject({ "category not sold": 1, "multipack or combo": 2 });
  });

  it("parses pack sizes and rejects multipacks", () => {
    expect(parseSize("1 kg")).toEqual({ pack_size: 1000, unit: "g" });
    expect(parseSize("1.5 L")).toEqual({ pack_size: 1500, unit: "ml" });
    expect(parseSize("12 pcs")).toEqual({ pack_size: 12, unit: "pcs" });
    expect(parseSize("2x150 ml")).toBeNull();
    expect(parseSize("Combo")).toBeNull();
  });
});

describe("catalog pipeline: stable IDs", () => {
  it("a rebuild with the same rows changes nothing", () => {
    const first = build();
    const second = build(rows, first.ledger, first.catalog);
    expect(second.catalog).toEqual(first.catalog);
    expect(second.ledger).toEqual(first.ledger);
  });

  it("new rows get new IDs after the highest one; old products keep theirs", () => {
    const first = build(rows.slice(0, 10));
    const second = build(rows, first.ledger, first.catalog);
    const max = Math.max(...first.catalog.map((p) => Number(p.id.slice(1))));
    for (const p of first.catalog) expect(second.catalog.find((x) => x.id === p.id)?.name).toBe(p.name);
    const added = second.catalog.filter((p) => !first.catalog.some((x) => x.id === p.id));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((p) => Number(p.id.slice(1)) > max)).toBe(true);
  });

  it("a product whose row disappears stays, out of stock, so saved carts still resolve", () => {
    const first = build();
    const rice = find(first.catalog, "Idli Rice");
    const second = build(rows.filter((r) => r.ProductName !== "Idli Rice"), first.ledger, first.catalog);
    expect(second.catalog.find((p) => p.id === rice.id)).toMatchObject({ name: "Idli Rice", in_stock: false });
    expect(second.report.retired).toEqual([rice.id]);
  });

  it("stock carries over from the last build", () => {
    const first = build();
    const paneer = find(first.catalog, "Paneer - Premium Fresh");
    const previous = first.catalog.map((p) => (p.id === paneer.id ? { ...p, in_stock: false } : p));
    expect(build(rows, first.ledger, previous).catalog.find((p) => p.id === paneer.id)?.in_stock).toBe(false);
  });

  it("without a ledger, takes IDs from the previous catalog by brand, name and size", () => {
    const first = build();
    const renumbered = first.catalog.map((p, i) => ({ ...p, id: `p${String(500 + i).padStart(3, "0")}` }));
    const { catalog } = build(rows, null, renumbered);
    expect(catalog.map((p) => p.id).sort()).toEqual(renumbered.map((p) => p.id).sort());
  });
});

describe("the committed catalog", () => {
  const catalog = CatalogSchema.parse(catalogJson);
  const ids = new Set(catalog.map((p) => p.id));
  const ledger = ledgerJson as Record<string, string>;

  it("has every product the agent eval's starting carts use", () => {
    const used = Object.values(agentCarts as Record<string, { carts: { items: { product_id: string }[] }[] }>).flatMap((s) => s.carts.flatMap((c) => c.items.map((it) => it.product_id)));
    expect(used.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("matches its ID ledger one to one", () => {
    const values = Object.values(ledger);
    expect(new Set(values).size).toBe(values.length);
    expect([...ids].filter((id) => !values.includes(id))).toEqual([]);
  });

  it("gives non-food no diet tags", () => {
    expect(catalog.filter((p) => !isFood(p) && p.tags.length > 0)).toEqual([]);
  });
});
