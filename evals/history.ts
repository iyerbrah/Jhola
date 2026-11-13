/**
 * The eval's history: one small entry per full run of the final suite, so the Results page can show how
 * the agent's accuracy changes over time. Appended by scripts/eval-chat.ts and committed with each run
 * (evals/chat/history.json); only the newest run keeps its transcripts (evals/chat/results/latest-final.json).
 */
import type { ChatSummary } from "./chatScore";

export const HISTORY_FILE = "evals/chat/history.json";
export const LATEST_FILE = "evals/chat/results/latest-final.json";

/** The eval's groups, gathered into the themes the Results page shows, in this order. */
export const THEMES: { id: string; title: string; groups: string[] }[] = [
  { id: "build", title: "Building carts", groups: ["everyday", "recipe", "occasion", "household", "personal", "build", "meal_idea"] },
  { id: "diet", title: "Diets, allergies and preferences", groups: ["dietary", "diet"] },
  { id: "money", title: "Money", groups: ["budget", "budget_gift"] },
  { id: "edit", title: "Editing and remembering", groups: ["edit", "memory", "conversation", "stock"] },
  { id: "talk", title: "Talking with the shopper", groups: ["question", "asking"] },
  { id: "limits", title: "Limits and safety", groups: ["not_possible", "safety", "confirm", "rare", "edge"] },
];

export type ThemeScore = { scenarios: number; passed: number };

export type HistoryEntry = {
  ran_at: string;
  model: string;
  /** The commit the run was played on (short hash), and what changed since the last run, in a line. */
  commit: string | null;
  note: string;
  scenarios: number;
  passed: number;
  /** The headline: the share of chats that ended with a cart ready to order. */
  ready_to_order: number | null;
  task_success: number;
  rule_breaks: number;
  rules_held: number | null;
  budget_kept: number | null;
  collateral_free: number | null;
  /** The share of "asking" chats passed: asked when the request was unclear, and only then. */
  asked_well: number | null;
  cost_per_turn_usd: number;
  latency_p50_ms: number;
  spent_usd: number | null;
  by_theme: Record<string, ThemeScore>;
};

/** Group scores summed into themes. */
export function themeScores(byGroup: ChatSummary["by_group"]): Record<string, ThemeScore> {
  const out: Record<string, ThemeScore> = {};
  for (const t of THEMES) {
    const g = t.groups.map((x) => byGroup[x]).filter(Boolean);
    if (g.length) out[t.id] = { scenarios: g.reduce((n, x) => n + x.scenarios, 0), passed: g.reduce((n, x) => n + x.passed, 0) };
  }
  return out;
}

export function historyEntry(a: { ran_at: string; model: string; commit: string | null; note: string; spent_usd: number | null; summary: ChatSummary }): HistoryEntry {
  const s = a.summary;
  const asking = s.by_group.asking;
  return {
    ran_at: a.ran_at,
    model: a.model,
    commit: a.commit,
    note: a.note,
    scenarios: s.scenarios,
    passed: s.passed,
    ready_to_order: s.ready_to_order ?? null,
    task_success: s.task_success,
    rule_breaks: s.rule_breaks,
    rules_held: s.rules_held,
    budget_kept: s.budget_kept,
    collateral_free: s.collateral_free,
    asked_well: asking ? asking.passed / asking.scenarios : null,
    cost_per_turn_usd: s.cost_per_turn_usd,
    latency_p50_ms: s.latency_p50_ms,
    spent_usd: a.spent_usd,
    by_theme: themeScores(s.by_group),
  };
}

/** The history with a new entry, oldest first; a re-run at the same instant replaces its entry. */
export function appendHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...history.filter((h) => h.ran_at !== entry.ran_at), entry].sort((a, b) => a.ran_at.localeCompare(b.ran_at));
}

/** How a number moved between the last two runs, in points: "+6 pts", "−2 pts", "no change". */
export function change(now: number | null | undefined, before: number | null | undefined): string | null {
  if (now == null || before == null) return null;
  const d = Math.round((now - before) * 100);
  return d === 0 ? "no change" : `${d > 0 ? "+" : "−"}${Math.abs(d)} pts`;
}
