import { describe, expect, it } from "vitest";
import { allScenarios } from "@/evals/chatScenarios";
import type { ChatSummary } from "@/evals/chatScore";
import { appendHistory, change, historyEntry, THEMES, themeScores, type HistoryEntry } from "@/evals/history";

const summary = (o: Partial<ChatSummary> = {}): ChatSummary =>
  ({
    scenarios: 4,
    passed: 3,
    task_success: 0.75,
    rule_breaks: 0,
    ready_to_order: 0.5,
    rules_held: 1,
    budget_kept: 1,
    collateral_free: 1,
    cost_per_turn_usd: 0.011,
    latency_p50_ms: 7000,
    by_group: { everyday: { scenarios: 2, passed: 2 }, edit: { scenarios: 1, passed: 0 }, asking: { scenarios: 1, passed: 1 } },
    ...o,
  }) as ChatSummary;

describe("the eval history", () => {
  it("records a run as one small entry: headline rates, commit, note and scores by theme", () => {
    const e = historyEntry({ ran_at: "2026-11-13T10:00:00Z", model: "m", commit: "abc1234", note: "First run", spent_usd: 1.3, summary: summary() });
    expect(e).toMatchObject({ commit: "abc1234", note: "First run", passed: 3, scenarios: 4, ready_to_order: 0.5, asked_well: 1, spent_usd: 1.3 });
    expect(e.by_theme).toEqual({ build: { scenarios: 2, passed: 2 }, edit: { scenarios: 1, passed: 0 }, talk: { scenarios: 1, passed: 1 } });
    expect(JSON.stringify(e).length).toBeLessThan(1000);
  });

  it("appends in time order, and a re-run at the same instant replaces its entry", () => {
    const at = (ran_at: string, passed = 1) => ({ ...historyEntry({ ran_at, model: "m", commit: null, note: "", spent_usd: null, summary: summary() }), passed }) as HistoryEntry;
    let h = appendHistory([], at("2026-11-14T00:00:00Z"));
    h = appendHistory(h, at("2026-11-13T00:00:00Z"));
    h = appendHistory(h, at("2026-11-14T00:00:00Z", 4));
    expect(h.map((x) => [x.ran_at.slice(0, 10), x.passed])).toEqual([
      ["2026-11-13", 1],
      ["2026-11-14", 4],
    ]);
  });

  it("says how a rate moved, in points", () => {
    expect(change(0.92, 0.85)).toBe("+7 pts");
    expect(change(0.8, 0.85)).toBe("−5 pts");
    expect(change(0.85, 0.85)).toBe("no change");
    expect(change(0.85, null)).toBeNull();
  });

  it("puts every group of the final suite in exactly one theme", () => {
    const groups = new Set(allScenarios("final").map((s) => s.group));
    for (const g of groups) expect(THEMES.filter((t) => t.groups.includes(g)).map((t) => t.id), g).toHaveLength(1);
    expect(Object.values(themeScores({ x: { scenarios: 1, passed: 1 } }))).toEqual([]);
  });
});
