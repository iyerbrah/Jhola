/**
 * Builds data/catalog.json from data/grocery.csv, the single source of truth for the grocery catalogue.
 *
 * Checks every row (see scripts/catalog/grocery.ts for the columns and rules) and fails with every problem
 * listed if any row is wrong. New rows with an empty id get the next free ID, written back to the CSV.
 * Also writes data/catalog/report.json, which the site reads for its product counts.
 *
 * Run: npm run catalog:build
 */
import fs from "node:fs";
import path from "node:path";
import { buildFromRows, parseCsv, reportFor, toCsv } from "./catalog/grocery";

const ROOT = path.resolve(__dirname, "..");
const file = (p: string) => path.join(ROOT, p);
const CSV = file("data/grocery.csv");
const RETIRED = file("data/catalog/retired-ids.json");
const OUT = file("data/catalog.json");
const REPORT = file("data/catalog/report.json");

const retired: string[] = fs.existsSync(RETIRED) ? JSON.parse(fs.readFileSync(RETIRED, "utf8")) : [];
const { products, rows, assigned, errors } = buildFromRows(parseCsv(fs.readFileSync(CSV, "utf8")), retired);

if (errors.length) {
  console.error(`data/grocery.csv has ${errors.length} problem${errors.length === 1 ? "" : "s"}:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

if (assigned.length) {
  fs.writeFileSync(CSV, toCsv(rows));
  console.log(`Gave ${assigned.length} new row${assigned.length === 1 ? "" : "s"} an ID: ${assigned.join(", ")}`);
}
const report = reportFor(products);
fs.writeFileSync(OUT, JSON.stringify(products, null, 1) + "\n");
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");

console.log(`Wrote ${report.products} grocery products (${report.food} food, ${report.non_food} household and personal care, ${report.out_of_stock} out of stock) in ${report.kinds} kinds`);
console.log(Object.entries(report.by_category).map(([c, n]) => `  ${c}: ${n}`).join("\n"));
