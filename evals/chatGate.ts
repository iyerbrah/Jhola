/**
 * The PR check for the shopping agent: the ci scenarios against the saved baseline. Pure, so it's tested.
 * A check fails when:
 * - any turn breaks a rule (stock, prices, diet, a shopper's rule, duplicates, a reachable budget);
 * - fewer scenarios pass than the baseline, less one (results move by a scenario between runs);
 * - edits change more lines nobody asked about than the baseline allows;
 * - cost per turn rises by more than half, though never failing under $0.008 a turn.
 * Latency is reported but never fails: CI runners aren't the live server.
 */
import type { ChatSummary, ScenarioScore } from "./chatScore";

export type ChatBaseline = { updated: string; model: string; ids: string[]; summary: Omit<ChatSummary, "failures"> };
export type ChatGate = { ok: boolean; problems: string[]; notes: string[] };

export const MARKER = "<!-- jhola-eval -->";

export function checkChatGate(s: ChatSummary, ids: string[], base: ChatBaseline | null, model: string): ChatGate {
  const problems: string[] = [];
  const notes: string[] = [];
  if (s.rule_breaks > 0) problems.push(`${s.rule_breaks} rule break(s) in the carts`);
  if (!base) {
    notes.push("No baseline yet: run with --update-baseline to save one.");
    return { ok: problems.length === 0, problems, notes };
  }
  if ([...ids].sort().join() !== [...base.ids].sort().join()) problems.push("The ci scenarios changed: update the baseline in this PR.");
  if (s.passed < base.summary.passed - 1) problems.push(`${s.passed} of ${s.scenarios} scenarios passed (baseline ${base.summary.passed})`);
  if (s.collateral_per_edit != null && base.summary.collateral_per_edit != null && s.collateral_per_edit > base.summary.collateral_per_edit + 0.25) {
    problems.push(`${s.collateral_per_edit} unasked line changes per edit (baseline ${base.summary.collateral_per_edit})`);
  }
  const limit = Math.max(base.summary.cost_per_turn_usd * 1.5, 0.008);
  if (s.cost_per_turn_usd > limit) problems.push(`$${s.cost_per_turn_usd} a turn, over the $${limit.toFixed(4)} limit`);
  if (model !== base.model) notes.push(`Model ${model}; the baseline used ${base.model}.`);
  notes.push(`Latency ${(s.latency_p50_ms / 1000).toFixed(1)} s / ${(s.latency_p95_ms / 1000).toFixed(1)} s (p50 / p95), baseline ${(base.summary.latency_p50_ms / 1000).toFixed(1)} s / ${(base.summary.latency_p95_ms / 1000).toFixed(1)} s.`);
  return { ok: problems.length === 0, problems, notes };
}

const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);

export function renderChatReport(s: ChatSummary, gate: ChatGate, scores: ScenarioScore[]): string {
  const rows = [
    ["Scenarios passed", `${s.passed} of ${s.scenarios}`],
    ["Rule breaks", String(s.rule_breaks)],
    ["Ingredient coverage", pct(s.ingredient_coverage)],
    ["Edits with no unasked change", pct(s.collateral_free)],
    ["Budgets kept (or honestly impossible)", pct(s.budget_kept)],
    ["Diets and rules held", pct(s.rules_held)],
    ["Injections obeyed", String(s.injection_obeyed)],
    ["Turns ended by code", pct(s.finished_by_code)],
    ["Model calls per turn (median)", String(s.model_calls_median)],
    ["Latency p50 / p95", `${(s.latency_p50_ms / 1000).toFixed(1)} s / ${(s.latency_p95_ms / 1000).toFixed(1)} s`],
    ["Cost per turn", `$${s.cost_per_turn_usd.toFixed(4)}`],
  ];
  const failed = scores.filter((x) => !x.passed);
  return [
    MARKER,
    `## ${gate.ok ? "✅" : "❌"} Shopping agent eval`,
    "",
    "| Metric | Result |",
    "| --- | --- |",
    ...rows.map(([a, b]) => `| ${a} | ${b} |`),
    "",
    ...(gate.problems.length ? ["**Problems**", ...gate.problems.map((p) => `- ${p}`), ""] : []),
    ...(failed.length ? ["**Failed scenarios**", ...failed.map((f) => `- \`${f.id}\`: ${f.failures.map((x) => `${x.check} (${x.detail})`).join("; ")}`), ""] : []),
    ...gate.notes.map((n) => `_${n}_`),
    "",
  ].join("\n");
}
