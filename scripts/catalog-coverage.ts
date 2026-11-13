/**
 * Checks that the grocery catalogue can serve what shoppers ask for (see scripts/catalog/coverage.ts).
 * Prints kinds without enough choice and every request it can't fully cover. Exits 1 if any kind is too
 * thin, a request names an unknown kind, fewer than 95% of requests are covered, or a reference cart
 * (built and checked in code, no model) fails review.
 *
 * Run: npm run catalog:coverage
 */
import requestsJson from "../evals/coverage/requests.json";
import { catalog } from "../lib/catalog";
import { auditCatalog } from "./catalog/audit";
import { checkRequests, coveredShare, kindDepth, referenceCarts, unknownKinds, type CoverageRequest } from "./catalog/coverage";

const TARGET = 0.95;
const requests = requestsJson.requests as CoverageRequest[];

const depth = kindDepth(catalog);
const unknown = unknownKinds(catalog, requests);
const results = checkRequests(catalog, requests);
const share = coveredShare(results);

const kinds = new Set(catalog.map((p) => p.sub_category)).size;
console.log(`Kinds: ${kinds - depth.length} of ${kinds} give a real choice`);
for (const d of depth) console.log(`  ✗ ${d.kind}: ${d.in_stock} in stock, ${d.brands} brands, ${d.sizes} sizes (needs ${d.needs})`);
if (unknown.length) console.log(`Unknown kinds in requests.json: ${unknown.join(", ")}`);

const byGroup = new Map<string, { ok: number; all: number }>();
for (const r of results) {
  const g = byGroup.get(r.request.group) ?? { ok: 0, all: 0 };
  g.all++;
  if (!r.missing.length) g.ok++;
  byGroup.set(r.request.group, g);
}
console.log(`\nRequests: ${results.length - results.filter((r) => r.missing.length).length} of ${results.length} fully covered (${Math.round(share * 100)}%, target ${TARGET * 100}%)`);
console.log([...byGroup].map(([g, { ok, all }]) => `  ${g}: ${ok}/${all}`).join("\n"));
for (const r of results.filter((x) => x.missing.length)) console.log(`  ✗ "${r.request.request}": nothing in stock for ${r.missing.join(", ")}`);

const carts = referenceCarts(catalog, requests);
const badCarts = carts.filter((c) => c.problems.length);
console.log(`\nReference carts (no model): ${carts.length - badCarts.length} of ${carts.length} pass review with every preference met`);
for (const c of badCarts) console.log(`  ✗ "${c.request.request}": ${c.problems.join("; ")}`);

const suspects = auditCatalog(catalog);
if (suspects.length) {
  console.log(`\nWorth a look (${suspects.length} rows; warnings, not failures):`);
  for (const x of suspects) console.log(`  ? ${x.id} ${x.name} [${x.kind}]: ${x.why}`);
}

if (depth.length || unknown.length || share < TARGET || badCarts.length) process.exit(1);
