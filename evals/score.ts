/**
 * Scores one eval query's response, and summarises a whole run.
 * Pure functions (no API calls) so they can be unit-tested.
 */
import type { CatalogIndex } from "@/lib/catalog";
import type { BuildCartsResponse, PricedVariant } from "@/lib/schema";
import { jaccard, MAX_JACCARD } from "@/lib/validate";

type Status = BuildCartsResponse["status"];

export type EvalCase = {
  group: "recipe" | "meal_idea" | "budget_gift" | "edge";
  query: string;
  expected_status: Status | Status[];
  budget_inr?: number;
  item_count?: number;
  /** sub_category (or tag) the counted items must have, e.g. "dark_chocolate" */
  item_kind?: string;
  /** Each group is a list of keywords; every cart must contain an item matching at least one keyword per group. */
  must_include_any?: string[][];
};

export type CaseScore = {
  query: string;
  group: EvalCase["group"];
  status: Status;
  status_ok: boolean;
  /** Passes every rule: real in-stock items, qty 1-10, no repeats, 3 distinct carts, the eval's own budget/count. */
  valid: boolean;
  repaired: boolean;
  /** null when the case has no budget or count. */
  constraints_ok: boolean | null;
  groups_hit: number;
  groups_total: number;
  /** Mean pairwise Jaccard on product IDs, null with fewer than 2 carts. */
  jaccard: number | null;
  latency_ms: number;
  cost_usd: number | null;
  problems: string[];
};

const expectedList = (c: EvalCase) => (Array.isArray(c.expected_status) ? c.expected_status : [c.expected_status]);

/** Does a cart item match a keyword? Looks at the product name and its sub_category. */
function itemMatches(item: PricedVariant["items"][number], keyword: string): boolean {
  const text = `${item.name} ${item.sub_category.replace(/_/g, " ")}`.toLowerCase();
  return text.includes(keyword.toLowerCase().replace(/_/g, " "));
}

function constraintProblems(v: PricedVariant, c: EvalCase, index: CatalogIndex): string[] {
  const problems: string[] = [];
  if (c.budget_inr != null && v.total > c.budget_inr) problems.push(`${v.name} is ₹${v.total}, over the ₹${c.budget_inr} budget`);
  if (c.item_count != null) {
    const required = [...new Set(v.items.filter((i) => !i.optional).map((i) => i.product_id))];
    const ofKind = required.filter((id) => {
      const p = index.get(id);
      return p && (!c.item_kind || p.sub_category === c.item_kind || p.tags.includes(c.item_kind));
    });
    if (ofKind.length !== c.item_count || ofKind.length !== required.length) {
      problems.push(`${v.name} has ${ofKind.length} ${c.item_kind ?? "items"} (+${required.length - ofKind.length} other), needs exactly ${c.item_count}`);
    }
  }
  return problems;
}

export function scoreCase(c: EvalCase, res: BuildCartsResponse, index: CatalogIndex, costUsd: number | null): CaseScore {
  const problems: string[] = [];
  const status_ok = expectedList(c).includes(res.status);
  if (!status_ok) problems.push(`status ${res.status}, expected ${expectedList(c).join(" or ")}`);

  const carts = res.variants;
  const wantsCarts = res.status !== "cannot_fulfil";

  // Rule checks, using the catalog as the source of truth.
  const rules: string[] = [];
  if (wantsCarts && carts.length !== 3) rules.push(`${carts.length} carts instead of 3`);
  for (const v of carts) {
    const seen = new Set<string>();
    for (const it of v.items) {
      const p = index.get(it.product_id);
      if (!p) rules.push(`${v.name}: ${it.product_id} not in catalog`);
      else if (!p.in_stock) rules.push(`${v.name}: ${p.name} is out of stock`);
      else if (p.price !== it.price) rules.push(`${v.name}: ${p.name} priced ₹${it.price}, catalog says ₹${p.price}`);
      if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 10) rules.push(`${v.name}: qty ${it.qty}`);
      if (seen.has(it.product_id)) rules.push(`${v.name}: ${it.product_id} repeated`);
      seen.add(it.product_id);
    }
    const sum = v.items.reduce((s, it) => (it.optional ? s : s + it.price * it.qty), 0);
    if (sum !== v.total) rules.push(`${v.name}: total ₹${v.total} but items add up to ₹${sum}`);
  }

  const constraint: string[] = carts.flatMap((v) => constraintProblems(v, c, index));
  const constraints_ok = c.budget_inr == null && c.item_count == null ? null : wantsCarts && carts.length > 0 && constraint.length === 0;

  const pairs: number[] = [];
  for (let i = 0; i < carts.length; i++) for (let j = i + 1; j < carts.length; j++) pairs.push(jaccard(carts[i], carts[j]));
  const jac = pairs.length ? pairs.reduce((a, b) => a + b, 0) / pairs.length : null;
  if (pairs.some((p) => p >= MAX_JACCARD)) rules.push(`two carts are ${Math.round(Math.max(...pairs) * 100)}% the same`);

  let groups_hit = 0;
  let groups_total = 0;
  for (const v of carts) {
    for (const group of c.must_include_any ?? []) {
      groups_total++;
      if (v.items.some((it) => group.some((k) => itemMatches(it, k)))) groups_hit++;
      else problems.push(`${v.name} has none of: ${group.join(", ")}`);
    }
  }

  problems.push(...rules, ...constraint);
  return {
    query: c.query,
    group: c.group,
    status: res.status,
    status_ok,
    valid: status_ok && rules.length === 0 && constraint.length === 0,
    repaired: res.meta.repaired,
    constraints_ok,
    groups_hit,
    groups_total,
    jaccard: jac,
    latency_ms: res.meta.latency_ms,
    cost_usd: costUsd,
    problems,
  };
}

/** Value at the given percentile (0-100), nearest-rank. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export type Summary = {
  cases: number;
  failed_runs: number;
  valid_first_try: number;
  valid_after_repair: number;
  constraints_met: number | null;
  ingredient_coverage: number | null;
  mean_jaccard: number | null;
  edge_status_correct: string;
  latency_p50_s: number;
  latency_p95_s: number;
  avg_cost_usd: number | null;
  total_cost_usd: number;
};

const share = (n: number, d: number) => (d ? n / d : null);

export function summarise(scores: CaseScore[], failedRuns = 0): Summary {
  const n = scores.length + failedRuns;
  const withConstraints = scores.filter((s) => s.constraints_ok !== null);
  const hit = scores.reduce((a, s) => a + s.groups_hit, 0);
  const total = scores.reduce((a, s) => a + s.groups_total, 0);
  const jac = scores.map((s) => s.jaccard).filter((j): j is number => j != null);
  const edges = scores.filter((s) => s.group === "edge");
  const costs = scores.map((s) => s.cost_usd).filter((c): c is number => c != null);
  const lat = scores.map((s) => s.latency_ms / 1000);
  return {
    cases: n,
    failed_runs: failedRuns,
    // A run that crashed (502) counts as invalid.
    valid_first_try: scores.filter((s) => s.valid && !s.repaired).length / n,
    valid_after_repair: scores.filter((s) => s.valid).length / n,
    constraints_met: share(withConstraints.filter((s) => s.constraints_ok).length, withConstraints.length),
    ingredient_coverage: share(hit, total),
    mean_jaccard: jac.length ? jac.reduce((a, b) => a + b, 0) / jac.length : null,
    edge_status_correct: `${edges.filter((s) => s.status_ok).length} of ${edges.length}`,
    latency_p50_s: percentile(lat, 50),
    latency_p95_s: percentile(lat, 95),
    avg_cost_usd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
    total_cost_usd: costs.reduce((a, b) => a + b, 0),
  };
}
