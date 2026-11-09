/**
 * Builds data/catalog.json from the BigBasket CSV (data/raw/bigbasket.csv) and the hand-added staples in
 * data/supplement.json. Keeps product IDs stable with data/catalog/ids.json and writes a quality report
 * to data/catalog/report.json. The pipeline itself is in scripts/catalog/build.ts.
 *
 * Run: npm run catalog:build
 */
import fs from "node:fs";
import path from "node:path";
import { CatalogSchema } from "../lib/schema";
import { buildCatalog, parseCsv, type Ledger, type Row, type SupplementItem } from "./catalog/build";

const ROOT = path.resolve(__dirname, "..");
const file = (p: string) => path.join(ROOT, p);
const CSV = file("data/raw/bigbasket.csv");
const OUT = file("data/catalog.json");
const LEDGER = file("data/catalog/ids.json");
const REPORT = file("data/catalog/report.json");

if (!fs.existsSync(CSV)) {
  console.error(`Missing ${path.relative(ROOT, CSV)}. Download the Kaggle "BigBasket Products" CSV and save it there.`);
  process.exit(1);
}

const readJson = <T>(p: string, fallback: T): T => (fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : fallback);

const { catalog, ledger, report } = buildCatalog({
  rows: parseCsv(fs.readFileSync(CSV, "utf8")) as unknown as Row[],
  supplement: readJson<SupplementItem[]>(file("data/supplement.json"), []),
  ledger: readJson<Ledger | null>(LEDGER, null),
  previous: CatalogSchema.parse(readJson(OUT, [])),
});

const sorted = Object.fromEntries(Object.entries(ledger).sort(([, a], [, b]) => Number(a.slice(1)) - Number(b.slice(1))));
fs.writeFileSync(OUT, JSON.stringify(catalog, null, 1) + "\n");
fs.writeFileSync(LEDGER, JSON.stringify(sorted, null, 1) + "\n");
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");

console.log(`Wrote ${report.products} products (${report.food} food, ${report.non_food} non-food, ${report.out_of_stock} out of stock, ${report.new_products} new) in ${report.kinds} kinds`);
console.log(Object.entries(report.by_category).map(([c, n]) => `  ${c}: ${n}`).join("\n"));
console.log(`Dropped: ${Object.entries(report.dropped).map(([r, n]) => `${r} ${n}`).join(", ")}`);
console.log(`Misfiling guard: ${report.home_skips.count} keyword matches skipped${report.retired.length ? `; retired: ${report.retired.join(", ")}` : ""}`);
