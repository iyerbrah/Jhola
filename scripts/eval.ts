/**
 * Runs the eval set through buildCarts() (the real pipeline and model, no HTTP),
 * prints every metric from the spec, and saves evals/results/<timestamp>.json.
 *
 * Run: npm run eval                       (all 30 queries, one at a time)
 *      npm run eval -- --concurrency=3    (faster, but latency numbers get noisier)
 *      npm run eval -- --group=edge       (one group only)
 */
import fs from "node:fs";
import path from "node:path";
import queries from "../evals/queries.json";
import { runCases } from "../evals/run";
import { summarise, type EvalCase, type Summary } from "../evals/score";
import { catalog } from "../lib/catalog";
import { modelName } from "../lib/llm";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const concurrency = Math.max(1, Number(arg("concurrency") ?? 1));
const group = arg("group");
const cases = (queries as EvalCase[]).filter((c) => !group || c.group === group);

const pct = (x: number | null) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);

function printSummary(s: Summary) {
  const rows: [string, string, string][] = [
    ["Valid on first try", pct(s.valid_first_try), "report"],
    ["Valid after repair", pct(s.valid_after_repair), "≥ 90%"],
    ["Constraints met", pct(s.constraints_met), "≥ 90%"],
    ["Ingredient coverage", pct(s.ingredient_coverage), "≥ 90%"],
    ["Variant distinctness (mean Jaccard)", s.mean_jaccard == null ? "n/a" : s.mean_jaccard.toFixed(2), "< 0.60"],
    ["Correct status (edge cases)", s.edge_status_correct, "5 of 5"],
    ["Latency p50 / p95", `${s.latency_p50_s.toFixed(1)} s / ${s.latency_p95_s.toFixed(1)} s`, "p95 < 8 s"],
    ["Cost per query (average)", s.avg_cost_usd == null ? "n/a" : `$${s.avg_cost_usd.toFixed(4)}`, "report"],
  ];
  console.log(`\n${"Metric".padEnd(38)}${"Result".padEnd(18)}Target`);
  console.log("-".repeat(66));
  for (const [m, v, t] of rows) console.log(`${m.padEnd(38)}${v.padEnd(18)}${t}`);
  console.log(`\n${s.cases} queries, ${s.failed_runs} crashed, total cost $${s.total_cost_usd.toFixed(3)}`);
}

async function main() {
  console.log(`Eval: ${cases.length} queries, model ${modelName()}, ${catalog.length} products, concurrency ${concurrency}\n`);
  const started = Date.now();
  const { scores, failures } = await runCases(cases, concurrency);
  const summary = summarise(scores, failures.length);
  printSummary(summary);

  const dir = path.resolve(__dirname, "../evals/results");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `${stamp}${group ? `-${group}` : ""}.json`);
  const meta = { model: modelName(), products: catalog.length, concurrency, group: group ?? "all", wall_time_s: Math.round((Date.now() - started) / 1000) };
  fs.writeFileSync(file, JSON.stringify({ meta, summary, failures, cases: scores }, null, 2) + "\n");
  console.log(`Saved ${path.relative(process.cwd(), file)}`);
}

main();
