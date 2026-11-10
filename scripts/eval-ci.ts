/**
 * The PR eval check. Runs the CI subset of the eval (queries marked "ci": true),
 * re-runs any query that failed once, compares the result with evals/baseline.json
 * and exits 1 on a regression. Writes a Markdown report for the PR comment.
 *
 * Run: npm run eval:ci                          (check against the baseline)
 *      npm run eval:ci -- --update-baseline     (save this run as the new baseline)
 *      npm run eval:ci -- --report=path.md      (where to write the report; default evals/ci-report.md)
 *
 * Costs about $0.15 per run (9 queries, plus any re-runs).
 */
import fs from "node:fs";
import path from "node:path";
import queries from "../evals/queries.json";
import { checkGate, mergeRetry, renderReport, toRetry, type Baseline } from "../evals/gate";
import { runCases } from "../evals/run";
import { summarise, type EvalCase } from "../evals/score";
import { catalog } from "../lib/catalog";
import { apiKeyName, modelName } from "../lib/llm";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const updateBaseline = process.argv.includes("--update-baseline");
const reportPath = path.resolve(arg("report") ?? "evals/ci-report.md");
const baselinePath = path.resolve(__dirname, "../evals/baseline.json");
// Three at a time keeps the run near a minute. Latency gets noisier, but it's only reported.
const CONCURRENCY = 3;

const cases = (queries as EvalCase[]).filter((c) => c.ci);

function readBaseline(): Baseline | null {
  try {
    return JSON.parse(fs.readFileSync(baselinePath, "utf8")) as Baseline;
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env[apiKeyName()]) {
    console.error(`${apiKeyName()} is not set: the eval check calls the real model.`);
    process.exit(1);
  }
  console.log(`Eval check: ${cases.length} CI queries, model ${modelName()}, ${catalog.length} products\n`);

  let run = await runCases(cases, CONCURRENCY);
  let retried: string[] = [];
  const again = toRetry(run);
  if (again.length) {
    console.log(`\nRe-running ${again.length} that failed once:`);
    const second = await runCases(cases.filter((c) => again.includes(c.query)), CONCURRENCY);
    ({ retried, ...run } = mergeRetry(run, second));
  }

  const summary = summarise(run.scores, run.failures.length);
  const queriesRun = cases.map((c) => c.query);

  if (updateBaseline) {
    if (run.failures.length || run.scores.some((s) => !s.valid)) {
      console.error("\nNot saving a baseline from a run where a query still fails. Fix it or run again.");
      process.exit(1);
    }
    const baseline: Baseline = { updated: new Date().toISOString(), model: modelName(), products: catalog.length, queries: queriesRun, summary };
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`\nSaved ${path.relative(process.cwd(), baselinePath)}. Commit it with the change that moved the numbers.`);
    return;
  }

  const input = { summary, scores: run.scores, failures: run.failures, retried, queries: queriesRun, model: modelName(), baseline: readBaseline() };
  const result = checkGate(input);
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
  const report = renderReport(result, input, runUrl);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report);
  console.log(`\n${report}`);
  console.log(`Report written to ${path.relative(process.cwd(), reportPath)}`);
  if (!result.pass) process.exit(1);
}

main();
