/**
 * npm run bench:solve: the solver on thousands of seeded random sessions over the real catalog.
 * No model calls, no cost. Reports validity, budget compliance, stability and speed, and saves
 * the result to evals/solver/latest.json for the public results page.
 *
 *   npm run bench:solve              # 3,000 sessions
 *   npm run bench:solve -- --n=10000
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { catalog, catalogIndex } from "../lib/catalog";
import { blockedBy, picksOf, solve } from "../lib/cart/solve";
import { review } from "../lib/cart/review";
import { cartTotal, QUALITIES, type Need, type Session } from "../lib/cart/types";
import { DIETS } from "../lib/requirements";
import { percentile } from "../lib/percentile";

const N = Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4)) || 3000;
const ctx = { products: catalog, index: catalogIndex };
const kinds = [...new Set(catalog.filter((p) => p.in_stock).map((p) => p.sub_category))].sort();

// A small seeded generator, so every run benchmarks the same sessions.
let seed = 20261112;
const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

function randomSession(): Session {
  const needs: Need[] = Array.from({ length: 3 + Math.floor(rand() * 12) }, (_, i) => {
    const unit = pick(["g", "g", "ml", "pcs", "pack"] as const);
    return {
      id: `n${i}`,
      group: pick(["dish", "cleaning"]),
      label: `Item ${i}`,
      kind: pick(kinds),
      amount: unit === "pack" ? 1 + Math.floor(rand() * 3) : unit === "pcs" ? 1 + Math.floor(rand() * 12) : 10 + Math.floor(rand() * 600),
      unit,
      per_person: rand() < 0.5,
      role: pick(["main", "core", "core", "core", "extra", "extra", "pantry"] as const),
      ticked: rand() < 0.85,
      count: rand() < 0.05 ? 2 + Math.floor(rand() * 3) : null,
      prefer: rand() < 0.2 ? pick(["organic", "fresh", "premium", "whole"]) : null,
      why: "",
      confidence: rand() < 0.3 ? "guess" : "sure",
    };
  });
  return {
    brief: {
      summary: "",
      people: rand() < 0.8 ? 1 + Math.floor(rand() * 8) : null,
      budget_inr: rand() < 0.5 ? 100 + Math.floor(rand() * 3000) : null,
      diet: rand() < 0.3 ? pick(DIETS) : null,
      quality: pick(QUALITIES),
      rules: rand() < 0.3 ? [{ kind: "exclude_word", value: pick(["onion", "garlic", "sugar", "milk"]), label: "rule" }] : [],
      assumptions: [],
      plan: [],
    },
    needs,
    pins: [],
    picks: {},
    choices: {},
  };
}

const ms: number[] = [];
let invalid = 0;
let budgeted = 0;
let feasible = 0;
let withinBudget = 0;
let unstable = 0;
let lines = 0;
let substitutions = 0;
let dropped = 0;
const spend: number[] = [];

for (let i = 0; i < N; i++) {
  const s = randomSession();
  const t = performance.now();
  const cart = solve(s, ctx);
  ms.push(performance.now() - t);
  lines += cart.lines.length;
  substitutions += cart.lines.filter((l) => l.substitution).length;
  dropped += cart.dropped.length;

  const bad =
    cart.total !== cartTotal(cart.lines) ||
    new Set(cart.lines.map((l) => l.product.id)).size !== cart.lines.length ||
    cart.lines.some((l) => {
      const p = catalogIndex.get(l.product.id);
      return !p || !p.in_stock || blockedBy(p, s.brief) != null || l.packs < 1 || l.packs > 10 || l.line_total !== p.price * l.packs;
    }) ||
    review(s, cart, catalogIndex).some((c) => c.status === "fail" && c.id !== "budget");
  if (bad) invalid++;

  const b = s.brief.budget_inr;
  if (b != null) {
    budgeted++;
    if (cart.floor_inr <= b) {
      feasible++;
      if (cart.total <= b) withinBudget++;
      spend.push(cart.total / b);
    }
  }
  const again = solve({ ...s, picks: picksOf(cart) }, ctx);
  if (JSON.stringify(again.lines.map((l) => [l.need_id, l.product.id, l.packs])) !== JSON.stringify(cart.lines.map((l) => [l.need_id, l.product.id, l.packs]))) unstable++;
}

const sorted = [...ms].sort((a, b) => a - b);
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const summary = {
  ran_at: new Date().toISOString(),
  sessions: N,
  catalog_size: catalog.length,
  valid_rate: round(1 - invalid / N, 4),
  within_budget_when_possible: feasible ? round(withinBudget / feasible, 4) : null,
  budget_sessions: budgeted,
  budget_possible: feasible,
  mean_budget_used: spend.length ? round(spend.reduce((a, b) => a + b, 0) / spend.length) : null,
  stable_rate: round(1 - unstable / N, 4),
  lines_per_cart: round(lines / N, 1),
  substitutions_per_cart: round(substitutions / N, 2),
  extras_dropped_per_cart: round(dropped / N, 2),
  ms_p50: round(percentile(sorted, 50), 2),
  ms_p95: round(percentile(sorted, 95), 2),
  ms_max: round(sorted.at(-1) ?? 0, 2),
};
console.table(summary);
mkdirSync("evals/solver", { recursive: true });
writeFileSync("evals/solver/latest.json", JSON.stringify(summary, null, 2) + "\n");
console.log("Saved evals/solver/latest.json");
if (invalid > 0 || withinBudget !== feasible) process.exit(1);
