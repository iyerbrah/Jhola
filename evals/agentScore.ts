/**
 * Scores the cart editor agent's eval (evals/agent/scenarios.json): each scenario starts from saved
 * carts, plays one or more shopper messages, and states checks about the final carts in code.
 * Pure functions (no API calls), so they're unit-tested.
 */
import type { AgentCart } from "@/lib/agent/carts";
import { checkCart } from "@/lib/agent/carts";
import type { CatalogIndex } from "@/lib/catalog";
import { cartTotal } from "@/lib/cartState";
import type { Diet } from "@/lib/requirements";
import type { Product } from "@/lib/schema";
import { matchesKind } from "@/lib/validate";
import { percentile } from "./score";

/**
 * Does a product count as this kind? Same matching as the cart builder's rules, except that a
 * kind starting with "=" must be the exact sub-category: "=rice" is rice, but not poha
 * ("Flattened & Beaten Rice"), which plain "rice" would match by name.
 */
export function isKind(p: Product, kind: string): boolean {
  return kind.startsWith("=") ? p.sub_category === kind.slice(1) : matchesKind(p, kind);
}

/** Carts are numbered from 1, as the shopper sees them. Kinds can use "=" for an exact sub-category (see isKind). */
export type AgentCheck =
  /** Every other cart is exactly as it started (items and requirements). */
  | { only_changed: number[] }
  /** Nothing changed at all. */
  | { unchanged: true }
  /** Every ordered item has this diet tag. */
  | { diet: [cart: number, diet: Diet] }
  /** At least one ordered item matches one of these kinds. */
  | { contains_any: [cart: number, kinds: string[]] }
  /** No ordered item matches any of these kinds. */
  | { lacks: [cart: number, kinds: string[]] }
  | { max_total: [cart: number, inr: number] }
  /** The total fell by at least this percentage. */
  | { total_drop_pct: [cart: number, pct: number] }
  /** Exactly this many distinct ordered products of this kind. */
  | { item_count: [cart: number, kind: string, n: number] }
  /** The total amount (packs × pack size) of this kind grew by at least this factor. */
  | { qty_ratio: [cart: number, kind: string, ratio: number] }
  /** The cart still has this kind, but none of the products it started with. */
  | { replaced: [cart: number, kind: string] }
  | { requirement: [cart: number, field: "budget_inr" | "diet", value: number | string | null] }
  /** The last reply mentions at least one of these (case-insensitive). */
  | { reply_any: string[] };

export const GROUPS = ["diet", "budget", "remove", "add", "swap_qty", "question", "not_possible", "multi_turn"] as const;

export type AgentScenario = {
  id: string;
  group: (typeof GROUPS)[number];
  /** Name of the starting carts in evals/agent/carts.json. */
  carts: string;
  /** The cart the shopper is looking at (1-based). */
  active: number;
  turns: string[];
  checks: AgentCheck[];
  /** Part of the subset the PR eval check runs. */
  ci?: boolean;
};

export type TurnRecord = {
  message: string;
  status: "done" | "gave_up";
  stop_reason: string;
  reply: string;
  model_calls: number;
  tool_calls: number;
  tool_errors: number;
  latency_ms: number;
  cost_usd: number | null;
};

export type ScenarioScore = {
  id: string;
  group: AgentScenario["group"];
  passed: boolean;
  failures: string[];
  /** Rule problems in carts the agent changed (must always be 0). */
  rule_breaks: number;
  /** A cart that should have stayed the same was changed. */
  wrong_carts: boolean;
  turns: TurnRecord[];
};

const same = (a: AgentCart, b: AgentCart) => JSON.stringify(a.items) === JSON.stringify(b.items) && JSON.stringify(a.requirements) === JSON.stringify(b.requirements);

/** Ordered lines (required, or optional and ticked) with their catalog products. */
function ordered(c: AgentCart, index: CatalogIndex) {
  return c.items.flatMap((it) => {
    const p = index.get(it.product_id);
    return it.included && p ? [{ it, p }] : [];
  });
}

function amountOf(c: AgentCart, kind: string, index: CatalogIndex): number {
  return ordered(c, index)
    .filter(({ p }) => isKind(p, kind))
    .reduce((sum, { it, p }) => sum + it.qty * p.pack_size, 0);
}

/** Problems with the final carts against one check (empty = passed). */
export function runCheck(check: AgentCheck, start: AgentCart[], final: AgentCart[], reply: string, index: CatalogIndex): string[] {
  const cart = (n: number) => final[n - 1];
  const name = (n: number) => `cart ${n}`;
  if ("only_changed" in check) {
    return final.flatMap((c, i) => (!check.only_changed.includes(i + 1) && !same(c, start[i]) ? [`${name(i + 1)} changed but shouldn't have`] : []));
  }
  if ("unchanged" in check) {
    return final.flatMap((c, i) => (same(c, start[i]) ? [] : [`${name(i + 1)} changed but nothing should have`]));
  }
  if ("diet" in check) {
    const [n, diet] = check.diet;
    return ordered(cart(n), index)
      .filter(({ p }) => !p.tags.includes(diet))
      .map(({ p }) => `${name(n)} has ${p.name}, which isn't ${diet}`);
  }
  if ("contains_any" in check) {
    const [n, kinds] = check.contains_any;
    return ordered(cart(n), index).some(({ p }) => kinds.some((k) => isKind(p, k))) ? [] : [`${name(n)} has none of: ${kinds.join(", ")}`];
  }
  if ("lacks" in check) {
    const [n, kinds] = check.lacks;
    return ordered(cart(n), index)
      .filter(({ p }) => kinds.some((k) => isKind(p, k)))
      .map(({ p }) => `${name(n)} still has ${p.name}`);
  }
  if ("max_total" in check) {
    const [n, inr] = check.max_total;
    const t = cartTotal(cart(n));
    return t <= inr ? [] : [`${name(n)} is ₹${t}, over ₹${inr}`];
  }
  if ("total_drop_pct" in check) {
    const [n, pct] = check.total_drop_pct;
    const before = cartTotal(start[n - 1]);
    const after = cartTotal(cart(n));
    return after <= before * (1 - pct / 100) ? [] : [`${name(n)} went from ₹${before} to ₹${after}, less than ${pct}% cheaper`];
  }
  if ("item_count" in check) {
    const [n, kind, want] = check.item_count;
    const got = new Set(ordered(cart(n), index).filter(({ p }) => isKind(p, kind)).map(({ p }) => p.id)).size;
    return got === want ? [] : [`${name(n)} has ${got} ${kind}, not ${want}`];
  }
  if ("qty_ratio" in check) {
    const [n, kind, ratio] = check.qty_ratio;
    const before = amountOf(start[n - 1], kind, index);
    const after = amountOf(cart(n), kind, index);
    return before > 0 && after >= before * ratio ? [] : [`${name(n)} has ${after} of ${kind} (started with ${before}); wanted ×${ratio}`];
  }
  if ("replaced" in check) {
    const [n, kind] = check.replaced;
    const old = new Set(ordered(start[n - 1], index).filter(({ p }) => isKind(p, kind)).map(({ p }) => p.id));
    const now = ordered(cart(n), index).filter(({ p }) => isKind(p, kind));
    if (!now.length) return [`${name(n)} has no ${kind} left`];
    const kept = now.filter(({ p }) => old.has(p.id));
    return kept.length ? kept.map(({ p }) => `${name(n)} still has the original ${p.name}`) : [];
  }
  if ("requirement" in check) {
    const [n, field, value] = check.requirement;
    const got = cart(n).requirements[field];
    return got === value ? [] : [`${name(n)} ${field} is ${got ?? "none"}, not ${value ?? "none"}`];
  }
  const words = check.reply_any;
  return words.some((w) => reply.toLowerCase().includes(w.toLowerCase())) ? [] : [`the reply mentions none of: ${words.join(", ")}`];
}

export function scoreScenario(s: AgentScenario, start: AgentCart[], final: AgentCart[], turns: TurnRecord[], index: CatalogIndex): ScenarioScore {
  const failures: string[] = [];
  turns.forEach((t, i) => {
    if (t.status !== "done") failures.push(`turn ${i + 1} gave up (${t.stop_reason})`);
  });
  const reply = turns.at(-1)?.reply ?? "";
  let wrong_carts = false;
  for (const check of s.checks) {
    const problems = runCheck(check, start, final, reply, index);
    if (problems.length && ("only_changed" in check || "unchanged" in check)) wrong_carts = true;
    failures.push(...problems);
  }
  const rule_breaks = final.reduce((sum, c, i) => sum + (same(c, start[i]) ? 0 : checkCart(c, index).length), 0);
  if (rule_breaks) failures.push(`${rule_breaks} rule problem(s) in changed carts`);
  return { id: s.id, group: s.group, passed: failures.length === 0, failures, rule_breaks, wrong_carts, turns };
}

export type AgentSummary = {
  scenarios: number;
  passed: number;
  task_success: number;
  rule_breaks: number;
  wrong_cart_scenarios: number;
  /** Questions and impossible requests that changed nothing, out of all of them. */
  no_change_ok: string;
  turns: number;
  gave_up_turns: number;
  tool_calls_per_turn: number;
  tool_errors_per_turn: number;
  model_calls_per_turn: number;
  latency_p50_s: number;
  latency_p95_s: number;
  cost_per_turn: number | null;
  total_cost_usd: number;
  by_group: Record<string, string>;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summariseAgent(scores: ScenarioScore[]): AgentSummary {
  const turns = scores.flatMap((s) => s.turns);
  const costs = turns.map((t) => t.cost_usd).filter((c): c is number => c != null);
  const noChange = scores.filter((s) => s.group === "question" || s.group === "not_possible");
  const by_group: Record<string, string> = {};
  for (const g of GROUPS) {
    const inGroup = scores.filter((s) => s.group === g);
    if (inGroup.length) by_group[g] = `${inGroup.filter((s) => s.passed).length}/${inGroup.length}`;
  }
  const passed = scores.filter((s) => s.passed).length;
  return {
    scenarios: scores.length,
    passed,
    task_success: scores.length ? passed / scores.length : 0,
    rule_breaks: scores.reduce((a, s) => a + s.rule_breaks, 0),
    wrong_cart_scenarios: scores.filter((s) => s.wrong_carts).length,
    no_change_ok: `${noChange.filter((s) => !s.wrong_carts).length} of ${noChange.length}`,
    turns: turns.length,
    gave_up_turns: turns.filter((t) => t.status !== "done").length,
    tool_calls_per_turn: mean(turns.map((t) => t.tool_calls)),
    tool_errors_per_turn: mean(turns.map((t) => t.tool_errors)),
    model_calls_per_turn: mean(turns.map((t) => t.model_calls)),
    latency_p50_s: percentile(turns.map((t) => t.latency_ms / 1000), 50),
    latency_p95_s: percentile(turns.map((t) => t.latency_ms / 1000), 95),
    cost_per_turn: costs.length ? mean(costs) : null,
    total_cost_usd: costs.reduce((a, b) => a + b, 0),
    by_group,
  };
}

// ---------- The PR check ----------

export type AgentBaseline = { updated: string; model: string; ids: string[]; summary: AgentSummary };
export type AgentGateCheck = { name: string; ok: boolean; detail: string };

export const AGENT_LIMITS = {
  /** Scenarios that may fail beyond the baseline's count: one, since a single run of 6 is noisy. */
  extraFailures: 1,
  costRise: 1.5,
};

export function checkAgentGate(summary: AgentSummary, ids: string[], model: string, baseline: AgentBaseline | null): { pass: boolean; checks: AgentGateCheck[]; notes: string[] } {
  const checks: AgentGateCheck[] = [];
  const notes: string[] = [];
  const sameIds = baseline != null && baseline.ids.length === ids.length && baseline.ids.every((id) => ids.includes(id));
  checks.push({
    name: "Baseline matches this subset",
    ok: sameIds,
    detail: sameIds ? `from ${baseline!.updated.slice(0, 10)}` : "no baseline, or the CI scenarios changed: run `npm run eval:agent -- --ci --update-baseline` and commit evals/agent/baseline.json",
  });
  if (baseline && baseline.model !== model) notes.push(`The model changed from ${baseline.model} to ${model}. If that's intended, update the agent baseline in this PR.`);
  checks.push({ name: "No rule breaks in changed carts", ok: summary.rule_breaks === 0, detail: `${summary.rule_breaks}` });
  const floor = Math.max(0, (baseline?.summary.passed ?? summary.scenarios) - AGENT_LIMITS.extraFailures);
  checks.push({ name: "Scenarios passed", ok: summary.passed >= floor, detail: `${summary.passed} of ${summary.scenarios} (needs ≥ ${floor})` });
  const baseCost = baseline?.summary.cost_per_turn ?? null;
  if (summary.cost_per_turn != null && baseCost != null) {
    const limit = baseCost * AGENT_LIMITS.costRise;
    checks.push({ name: "Cost per turn", ok: summary.cost_per_turn <= limit, detail: `$${summary.cost_per_turn.toFixed(4)} (needs ≤ $${limit.toFixed(4)})` });
  }
  if (baseline) {
    const b = baseline.summary;
    notes.push(`Latency per turn p50 / p95: ${summary.latency_p50_s.toFixed(1)} s / ${summary.latency_p95_s.toFixed(1)} s (baseline ${b.latency_p50_s.toFixed(1)} s / ${b.latency_p95_s.toFixed(1)} s). Reported only.`);
  }
  return { pass: checks.every((c) => c.ok), checks, notes };
}

export function renderAgentReport(gate: ReturnType<typeof checkAgentGate>, summary: AgentSummary, scores: ScenarioScore[], baseline: AgentBaseline | null, retried: string[]): string {
  const b = baseline?.summary;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const failed = scores.filter((s) => !s.passed);
  const lines = [
    `## ${gate.pass ? "✅" : "❌"} Agent eval check: ${gate.pass ? "passed" : "failed"}`,
    "",
    `${summary.scenarios} scenarios (${summary.turns} turns) from the agent eval's CI subset.`,
    "",
    "| Check | Result | |",
    "| --- | --- | --- |",
    ...gate.checks.map((c) => `| ${c.name} | ${c.detail} | ${c.ok ? "✅" : "❌"} |`),
    "",
    "| Metric | This PR | Baseline |",
    "| --- | --- | --- |",
    `| Task success | ${pct(summary.task_success)} | ${b ? pct(b.task_success) : "n/a"} |`,
    `| Wrong carts changed | ${summary.wrong_cart_scenarios} | ${b?.wrong_cart_scenarios ?? "n/a"} |`,
    `| Tool calls / errors per turn | ${summary.tool_calls_per_turn.toFixed(1)} / ${summary.tool_errors_per_turn.toFixed(1)} | ${b ? `${b.tool_calls_per_turn.toFixed(1)} / ${b.tool_errors_per_turn.toFixed(1)}` : "n/a"} |`,
    `| Latency p50 / p95 per turn | ${summary.latency_p50_s.toFixed(1)} / ${summary.latency_p95_s.toFixed(1)} s | ${b ? `${b.latency_p50_s.toFixed(1)} / ${b.latency_p95_s.toFixed(1)} s` : "n/a"} |`,
    `| Cost per turn | ${summary.cost_per_turn == null ? "n/a" : `$${summary.cost_per_turn.toFixed(4)}`} | ${b?.cost_per_turn == null ? "n/a" : `$${b.cost_per_turn.toFixed(4)}`} |`,
  ];
  if (failed.length) lines.push("", "Failed scenarios:", ...failed.map((s) => `- \`${s.id}\`: ${s.failures.slice(0, 3).join("; ")}`));
  const notes = [...gate.notes, ...(retried.length ? [`Run twice because the first try failed: ${retried.join(", ")}. Only the second try counts.`] : [])];
  if (notes.length) lines.push("", ...notes.map((n) => `- ${n}`));
  return lines.join("\n") + "\n";
}
