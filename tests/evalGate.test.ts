import { describe, expect, it } from "vitest";
import { checkGate, mergeRetry, renderReport, toRetry, type Baseline, type GateInput } from "@/evals/gate";
import { summarise, type CaseScore } from "@/evals/score";

const score = (query: string, overrides: Partial<CaseScore> = {}): CaseScore => ({
  query,
  group: "recipe",
  status: "ok",
  status_ok: true,
  valid: true,
  repaired: false,
  constraints_ok: null,
  groups_hit: 3,
  groups_total: 3,
  jaccard: 0.2,
  latency_ms: 5000,
  cost_usd: 0.02,
  problems: [],
  ...overrides,
});

const QUERIES = ["dal for 2", "biryani for 4", "a laptop"];
const good = QUERIES.map((q) => score(q));
const baseline: Baseline = { updated: "2026-11-08T12:00:00.000Z", model: "m1", products: 1006, queries: QUERIES, summary: summarise(good) };

const input = (scores: CaseScore[], overrides: Partial<GateInput> = {}): GateInput => ({
  summary: summarise(scores),
  scores,
  failures: [],
  retried: [],
  queries: QUERIES,
  model: "m1",
  baseline,
  ...overrides,
});

const check = (r: ReturnType<typeof checkGate>, name: string) => r.checks.find((c) => c.name === name);

describe("checkGate", () => {
  it("passes a run that matches the baseline", () => {
    const r = checkGate(input(good));
    expect(r.pass).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("fails when any query breaks a rule, and names it", () => {
    const scores = [score("dal for 2"), score("biryani for 4", { valid: false, problems: ["Budget is over the ₹500 budget"] }), score("a laptop")];
    const r = checkGate(input(scores));
    expect(r.pass).toBe(false);
    expect(check(r, "Every query passes every rule")?.detail).toContain("biryani for 4: Budget is over");
  });

  it("fails when a query crashed", () => {
    const r = checkGate(input(good.slice(0, 2), { failures: [{ query: "a laptop", error: "Timed out" }], summary: summarise(good.slice(0, 2), 1) }));
    expect(r.pass).toBe(false);
    expect(check(r, "Every query passes every rule")?.detail).toContain("a laptop: crashed (Timed out)");
  });

  it("allows a small drop in ingredient coverage but not a big one", () => {
    // Baseline 100%. 28 of 30 groups (93%) is inside the 8-point slack; 8 of 9 (89%) is under the 90% floor.
    const small = [score("dal for 2", { groups_hit: 8, groups_total: 10 }), score("biryani for 4", { groups_hit: 10, groups_total: 10 }), score("a laptop", { groups_hit: 10, groups_total: 10 })];
    expect(check(checkGate(input(small)), "Ingredient coverage")?.ok).toBe(true);
    const big = [score("dal for 2", { groups_hit: 2, groups_total: 3 }), score("biryani for 4"), score("a laptop")];
    expect(check(checkGate(input(big)), "Ingredient coverage")?.ok).toBe(false);
  });

  it("fails when carts become too alike or cost jumps", () => {
    const alike = good.map((s) => ({ ...s, jaccard: 0.45 }));
    expect(check(checkGate(input(alike)), "Carts stay different")?.ok).toBe(false);
    const pricey = good.map((s) => ({ ...s, cost_usd: 0.031 }));
    expect(check(checkGate(input(pricey)), "Cost per query")?.ok).toBe(false);
    const slightlyPricier = good.map((s) => ({ ...s, cost_usd: 0.029 }));
    expect(check(checkGate(input(slightlyPricier)), "Cost per query")?.ok).toBe(true);
  });

  it("never fails on latency, only reports it", () => {
    const slow = good.map((s) => ({ ...s, latency_ms: 30_000 }));
    const r = checkGate(input(slow));
    expect(r.pass).toBe(true);
    expect(r.notes.join(" ")).toContain("Latency p50 / p95: 30.0 s");
  });

  it("fails when there is no baseline or it covers different queries", () => {
    expect(checkGate(input(good, { baseline: null })).pass).toBe(false);
    const stale = { ...baseline, queries: ["dal for 2", "biryani for 4", "food"] };
    expect(check(checkGate(input(good, { baseline: stale })), "Baseline matches this subset")?.ok).toBe(false);
  });

  it("notes a model change without failing on it", () => {
    const r = checkGate(input(good, { model: "m2" }));
    expect(r.pass).toBe(true);
    expect(r.notes[0]).toContain("from m1 to m2");
  });
});

describe("retries", () => {
  it("re-runs only what crashed or broke a rule", () => {
    const run = { scores: [score("dal for 2"), score("biryani for 4", { valid: false })], failures: [{ query: "a laptop", error: "x" }] };
    expect(toRetry(run).sort()).toEqual(["a laptop", "biryani for 4"]);
  });

  it("keeps the second try's result and the original order", () => {
    const first = { scores: [score("dal for 2"), score("biryani for 4", { valid: false })], failures: [{ query: "a laptop", error: "x" }] };
    const second = { scores: [score("biryani for 4"), score("a laptop")], failures: [] };
    const merged = mergeRetry(first, second);
    expect(merged.scores.map((s) => [s.query, s.valid])).toEqual([
      ["dal for 2", true],
      ["biryani for 4", true],
      ["a laptop", true],
    ]);
    expect(merged.failures).toEqual([]);
    expect(merged.retried.sort()).toEqual(["a laptop", "biryani for 4"]);
  });
});

describe("renderReport", () => {
  it("starts with the marker the workflow looks for and shows the verdict", () => {
    const r = checkGate(input(good));
    const md = renderReport(r, input(good), "https://example.test/run/1");
    expect(md.split("\n")[0]).toBe("<!-- jhola-eval -->");
    expect(md).toContain("✅ Eval check: passed");
    expect(md).toContain("[Run log](https://example.test/run/1)");
  });
});
