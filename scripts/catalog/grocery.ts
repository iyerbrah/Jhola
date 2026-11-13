/**
 * The grocery catalogue pipeline: data/grocery.csv in, data/catalog.json out.
 *
 * data/grocery.csv is the single source of truth. Edit it in any spreadsheet; this code checks every row
 * and turns it into the products the app loads. Pure functions only, so tests can run it on a small fixture.
 * scripts/build-catalog.ts does the file IO.
 *
 * Columns (multi-value cells are separated by "|"):
 *   id            p001, p002, ... Stable: carts, pins and share links depend on it. Leave it empty on a new
 *                 row and the build gives it the next free ID. Never reuse a retired one.
 *   name, brand   What the shopper sees.
 *   category      One of CATEGORIES (lib/schema.ts). Every product of a kind has the same category.
 *   kind          What the agent plans with ("milk", "toor_dal"). Lowercase words joined by "_".
 *   pack_size     A number, in `unit`.
 *   unit          g, ml or pcs.
 *   price         Whole rupees.
 *   in_stock      true or false.
 *   diet          veg | vegan | jain. Food only. Vegan and jain products are also veg.
 *   contains      dairy | egg | gluten | nuts | peanut | soy. Food only.
 *   labels        organic | sugar_free | high_protein | whole_grain.
 *   search_terms  Words shoppers use for it: Hindi names, everyday terms ("dahi", "cold drink").
 *   description   Seller-written text. Untrusted: empty except for the planted prompt-injection demo.
 */
import { CATEGORIES, CONTAINS, DIET_TAGS, LABELS, isFood, type Category, type Product, type Unit } from "../../lib/schema";

export const COLUMNS = [
  "id",
  "name",
  "brand",
  "category",
  "kind",
  "pack_size",
  "unit",
  "price",
  "in_stock",
  "diet",
  "contains",
  "labels",
  "search_terms",
  "description",
] as const;
export type Row = Record<(typeof COLUMNS)[number], string>;

/** Every kind needs this many products in stock, so the agent and the shopper always have a choice. */
export const MIN_IN_STOCK_PER_KIND = 3;
/** When the prices in the CSV were last set. Shown on the site: prices are approximate. */
export const PRICES_AS_OF = "November 2026";

// ---------- CSV ----------

/** Minimal CSV parser: handles quoted fields with commas, "" escapes and newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header = [], ...body] = rows.filter((r) => r.some((f) => f.trim() !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, "").trim(), (r[i] ?? "").trim()])));
}

const quote = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Writes rows back as CSV with the standard columns, in order. */
export function toCsv(rows: Row[]): string {
  return [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => quote(r[c] ?? "")).join(","))].join("\n") + "\n";
}

// ---------- Rows -> products ----------

const list = (cell: string) =>
  cell
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
const KIND = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const ID = /^p\d{3,}$/;
const idNumber = (id: string) => Number(id.slice(1));

export type BuildResult = {
  products: Product[];
  /** Rows as they should be saved: new rows have their IDs. */
  rows: Row[];
  /** IDs given to new rows on this build. */
  assigned: string[];
  /** Problems, each with its CSV line. The build fails if there are any. */
  errors: string[];
};

/**
 * Checks every row and turns it into a product. New rows (empty id) get the next free ID, after every
 * ID in use and every retired one. Returns all errors at once, so one build shows everything to fix.
 */
export function buildFromRows(input: Record<string, string>[], retired: string[] = []): BuildResult {
  const errors: string[] = [];
  const missing = input.length ? COLUMNS.filter((c) => !(c in input[0])) : [];
  if (missing.length) return { products: [], rows: [], assigned: [], errors: [`missing columns: ${missing.join(", ")}`] };

  const rows = input.map((r) => Object.fromEntries(COLUMNS.map((c) => [c, r[c] ?? ""])) as Row);
  const retiredSet = new Set(retired);
  let next = Math.max(0, ...rows.filter((r) => ID.test(r.id)).map((r) => idNumber(r.id)), ...retired.filter((id) => ID.test(id)).map(idNumber)) + 1;
  const assigned: string[] = [];
  for (const r of rows) {
    if (r.id) continue;
    r.id = `p${String(next++).padStart(3, "0")}`;
    assigned.push(r.id);
  }

  const products: Product[] = [];
  const seenIds = new Set<string>();
  const seenProducts = new Map<string, number>();
  const kindCategory = new Map<string, { category: string; line: number }>();
  rows.forEach((r, i) => {
    const line = i + 2; // the header is line 1
    const bad = (msg: string) => errors.push(`line ${line} (${r.id || "no id"} ${r.name}): ${msg}`);
    const before = errors.length;

    if (!ID.test(r.id)) bad(`id "${r.id}" must look like p123`);
    else if (seenIds.has(r.id)) bad(`id ${r.id} is used twice`);
    else if (retiredSet.has(r.id)) bad(`id ${r.id} belonged to a product that was removed; leave id empty for a new one`);
    seenIds.add(r.id);
    if (r.name.length < 2) bad("name is missing");
    if (!r.brand) bad("brand is missing");
    if (!(CATEGORIES as readonly string[]).includes(r.category)) bad(`category "${r.category}" is not one of ${CATEGORIES.join(", ")}`);
    if (!KIND.test(r.kind)) bad(`kind "${r.kind}" must be lowercase words joined by _`);
    else {
      const first = kindCategory.get(r.kind);
      if (!first) kindCategory.set(r.kind, { category: r.category, line });
      else if (first.category !== r.category) bad(`kind ${r.kind} is ${first.category} on line ${first.line}, not ${r.category}`);
    }
    const packSize = Number(r.pack_size);
    if (!(packSize > 0)) bad(`pack_size "${r.pack_size}" must be a positive number`);
    if (!["g", "ml", "pcs"].includes(r.unit)) bad(`unit "${r.unit}" must be g, ml or pcs`);
    const price = Number(r.price);
    if (!Number.isInteger(price) || price <= 0) bad(`price "${r.price}" must be whole rupees`);
    if (r.in_stock !== "true" && r.in_stock !== "false") bad(`in_stock "${r.in_stock}" must be true or false`);
    if (r.description.length > 300) bad("description is longer than 300 characters");

    const food = isFood({ category: r.category });
    const diet = list(r.diet);
    const contains = list(r.contains);
    const labels = list(r.labels);
    for (const d of diet) if (!(DIET_TAGS as readonly string[]).includes(d)) bad(`diet "${d}" is not one of ${DIET_TAGS.join(", ")}`);
    for (const c of contains) if (!(CONTAINS as readonly string[]).includes(c)) bad(`contains "${c}" is not one of ${CONTAINS.join(", ")}`);
    for (const l of labels) if (!(LABELS as readonly string[]).includes(l)) bad(`label "${l}" is not one of ${LABELS.join(", ")}`);
    if (!food && diet.length) bad("diet is for food only: household and personal care products leave it empty");
    if (!food && contains.length) bad("contains is for food only");
    if ((diet.includes("vegan") || diet.includes("jain")) && !diet.includes("veg")) bad("vegan and jain products are also veg");
    if (diet.includes("vegan") && (contains.includes("dairy") || contains.includes("egg"))) bad("a vegan product can't contain dairy or egg");
    if (diet.includes("veg") && contains.includes("egg")) bad("a veg product can't contain egg");

    const key = `${r.brand}|${r.name}|${r.pack_size}${r.unit}`.toLowerCase();
    const dup = seenProducts.get(key);
    if (dup) bad(`same brand, name and size as line ${dup}`);
    seenProducts.set(key, line);

    if (errors.length > before) return;
    const terms = list(r.search_terms);
    products.push({
      id: r.id,
      name: r.name,
      brand: r.brand,
      category: r.category as Category,
      sub_category: r.kind,
      pack_size: packSize,
      unit: r.unit as Unit,
      price,
      in_stock: r.in_stock === "true",
      tags: [...diet, ...labels],
      ...(contains.length ? { contains: contains as Product["contains"] } : {}),
      ...(terms.length ? { search_terms: terms } : {}),
      ...(r.description ? { description: r.description } : {}),
    });
  });

  // Every kind keeps a real choice in stock.
  const inStock = new Map<string, number>();
  for (const k of kindCategory.keys()) inStock.set(k, 0);
  for (const p of products) if (p.in_stock) inStock.set(p.sub_category, (inStock.get(p.sub_category) ?? 0) + 1);
  for (const [kind, n] of inStock)
    if (n < MIN_IN_STOCK_PER_KIND) errors.push(`kind ${kind}: ${n} in stock, needs at least ${MIN_IN_STOCK_PER_KIND} (add products or mark more in stock)`);

  products.sort((a, b) => idNumber(a.id) - idNumber(b.id));
  return { products, rows, assigned, errors };
}

// ---------- Report ----------

export type Report = {
  products: number;
  food: number;
  non_food: number;
  out_of_stock: number;
  kinds: number;
  by_category: Record<string, number>;
  prices_as_of: string;
};

export function reportFor(products: Product[]): Report {
  const by_category: Record<string, number> = {};
  for (const c of CATEGORIES) by_category[c] = 0;
  for (const p of products) by_category[p.category]++;
  const food = products.filter(isFood).length;
  return {
    products: products.length,
    food,
    non_food: products.length - food,
    out_of_stock: products.filter((p) => !p.in_stock).length,
    kinds: new Set(products.map((p) => p.sub_category)).size,
    by_category,
    prices_as_of: PRICES_AS_OF,
  };
}
