/**
 * The PR eval check: compares a run of the CI subset against the saved baseline
 * (evals/baseline.json) and decides pass or fail. Pure functions, unit-tested.
 *
 * Model answers vary from run to run, so the check is built to fail on real
 * regressions, not noise: a failing query gets one re-run before it counts,
 * averages get some slack against the baseline, and latency is reported but
 * never fails the check (GitHub's runners are not the live server).
 */
import type { RunFailure, RunResult } from "./run";
import type { CaseScore, Summary } from "./score";

export type Baseline = {
  updated: string;
  model: string;
  products: number;
  queries: string[];
  summary: Summary;
};

export type GateCheck = { name: string; ok: boolean; detail: string };
export type GateResult = { pass: boolean; checks: GateCheck[]; notes: string[] };

export type GateInput = {
  summary: Summary;
  scores: CaseScore[];
  failures: RunFailure[];
  /** Queries that failed once and were run again. */
  retried: string[];
  queries: string[];
  model: string;
  baseline: Baseline | null;
};

export const LIMITS = {
  /** The spec's target for ingredient coverage. */
  coverageFloor: 0.9,
  /**
   * How far coverage may fall below the baseline: about 3 of the subset's 39 ingredient groups.
   * Two back-to-back runs of unchanged code differed by one group, so less slack would flag noise.
   */
  coverageDrop: 0.08,
  /** The spec's limit for mean Jaccard between carts (higher = more alike). */
  jaccardCeiling: 0.6,
  /** How far mean Jaccard may rise above the baseline. */
  jaccardRise: 0.1,
  /** Average cost per query may grow to this multiple of the baseline. */
  costRise: 1.5,
};

/** Replaces each retried query's first result with its re-run. Only the re-run's crashes count. */
export function mergeRetry(first: RunResult, second: RunResult): RunResult & { retried: string[] } {
  const retried = [...second.scores.map((s) => s.query), ...second.failures.map((f) => f.query)];
  const kept = first.scores.filter((s) => !retried.includes(s.query));
  const order = (q: string) => {
    const i = first.scores.findIndex((s) => s.query === q);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return {
    scores: [...kept, ...second.scores].sort((a, b) => order(a.query) - order(b.query)),
    failures: second.failures,
    retried,
  };
}

/** Queries worth a second run: anything that crashed or broke a rule. */
export function toRetry(run: RunResult): string[] {
  return [...run.failures.map((f) => f.query), ...run.scores.filter((s) => !s.valid).map((s) => s.query)];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function checkGate(input: GateInput): GateResult {
  const { summary: s, scores, failures, baseline } = input;
  const checks: GateCheck[] = [];
  const notes: string[] = [];

  // The baseline must describe this same subset, or the comparison means nothing.
  const sameQueries =
    baseline != null && baseline.queries.length === input.queries.length && baseline.queries.every((q) => input.queries.includes(q));
  checks.push({
    name: "Baseline matches this subset",
    ok: sameQueries,
    detail: sameQueries
      ? `from ${baseline!.updated.slice(0, 10)}`
      : "the CI queries changed or there is no baseline: run `npm run eval:ci -- --update-baseline` and commit evals/baseline.json",
  });
  if (baseline && baseline.model !== input.model) {
    notes.push(`The model changed from ${baseline.model} to ${input.model}. If that's intended, update the baseline in this PR.`);
  }

  // Every query must pass every rule (real in-stock items, prices, budgets, counts, 3 distinct carts, right status).
  const broken = [
    ...failures.map((f) => `${f.query}: crashed (${f.error})`),
    ...scores.filter((c) => !c.valid).map((c) => `${c.query}: ${c.problems[0] ?? "invalid"}`),
  ];
  checks.push({
    name: "Every query passes every rule",
    ok: broken.length === 0,
    detail: broken.length === 0 ? `${scores.length} of ${s.cases}` : broken.join("; "),
  });

  if (s.ingredient_coverage != null) {
    const base = baseline?.summary.ingredient_coverage ?? null;
    const floor = Math.max(LIMITS.coverageFloor, base == null ? 0 : base - LIMITS.coverageDrop);
    checks.push({
      name: "Ingredient coverage",
      ok: s.ingredient_coverage >= floor - 1e-9,
      detail: `${pct(s.ingredient_coverage)} (needs ≥ ${pct(floor)})`,
    });
  }

  if (s.mean_jaccard != null) {
    const base = baseline?.summary.mean_jaccard ?? null;
    const ceiling = Math.min(LIMITS.jaccardCeiling, base == null ? 1 : base + LIMITS.jaccardRise);
    checks.push({
      name: "Carts stay different",
      ok: s.mean_jaccard <= ceiling + 1e-9,
      detail: `mean Jaccard ${s.mean_jaccard.toFixed(2)} (needs ≤ ${ceiling.toFixed(2)})`,
    });
  }

  const baseCost = baseline?.summary.avg_cost_usd ?? null;
  if (s.avg_cost_usd != null && baseCost != null) {
    const limit = baseCost * LIMITS.costRise;
    checks.push({
      name: "Cost per query",
      ok: s.avg_cost_usd <= limit,
      detail: `$${s.avg_cost_usd.toFixed(4)} (needs ≤ $${limit.toFixed(4)})`,
    });
  }

  if (input.retried.length) {
    notes.push(`Run twice because the first try failed: ${input.retried.join("; ")}. Only the second try counts.`);
  }
  if (baseline) {
    const b = baseline.summary;
    notes.push(
      `Latency p50 / p95: ${s.latency_p50_s.toFixed(1)} s / ${s.latency_p95_s.toFixed(1)} s (baseline ${b.latency_p50_s.toFixed(1)} s / ${b.latency_p95_s.toFixed(1)} s). Reported only: runner network speed varies.`,
    );
  }

  return { pass: checks.every((c) => c.ok), checks, notes };
}

/** The PR comment. The first line is a marker so the workflow can find and update its own comment. */
export function renderReport(result: GateResult, input: GateInput, runUrl?: string): string {
  const s = input.summary;
  const b = input.baseline?.summary;
  const pctOr = (x: number | null | undefined) => (x == null ? "n/a" : pct(x));
  const lines = [
    "<!-- jhola-eval -->",
    `## ${result.pass ? "✅" : "❌"} Eval check: ${result.pass ? "passed" : "failed"}`,
    "",
    `${s.cases} queries from the CI subset, model \`${input.model}\`.${runUrl ? ` [Run log](${runUrl})` : ""}`,
    "",
    "| Check | Result | |",
    "| --- | --- | --- |",
    ...result.checks.map((c) => `| ${c.name} | ${c.detail} | ${c.ok ? "✅" : "❌"} |`),
    "",
    "| Metric | This PR | Baseline |",
    "| --- | --- | --- |",
    `| Valid on first try | ${pct(s.valid_first_try)} | ${pctOr(b?.valid_first_try)} |`,
    `| Valid after repair | ${pct(s.valid_after_repair)} | ${pctOr(b?.valid_after_repair)} |`,
    `| Constraints met | ${pctOr(s.constraints_met)} | ${pctOr(b?.constraints_met)} |`,
    `| Ingredient coverage | ${pctOr(s.ingredient_coverage)} | ${pctOr(b?.ingredient_coverage)} |`,
    `| Mean Jaccard | ${s.mean_jaccard?.toFixed(2) ?? "n/a"} | ${b?.mean_jaccard?.toFixed(2) ?? "n/a"} |`,
    `| Edge statuses | ${s.edge_status_correct} | ${b?.edge_status_correct ?? "n/a"} |`,
    `| Latency p50 / p95 | ${s.latency_p50_s.toFixed(1)} / ${s.latency_p95_s.toFixed(1)} s | ${b ? `${b.latency_p50_s.toFixed(1)} / ${b.latency_p95_s.toFixed(1)} s` : "n/a"} |`,
    `| Cost per query | ${s.avg_cost_usd == null ? "n/a" : `$${s.avg_cost_usd.toFixed(4)}`} | ${b?.avg_cost_usd == null ? "n/a" : `$${b.avg_cost_usd.toFixed(4)}`} |`,
  ];
  if (result.notes.length) lines.push("", ...result.notes.map((n) => `- ${n}`));
  return lines.join("\n") + "\n";
}
