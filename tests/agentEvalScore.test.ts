import { describe, expect, it } from "vitest";
import cartsJson from "@/evals/agent/carts.json";
import scenariosJson from "@/evals/agent/scenarios.json";
import { checkAgentGate, runCheck, scoreScenario, summariseAgent, type AgentScenario, type ScenarioScore, type TurnRecord } from "@/evals/agentScore";
import { CartsInputSchema, repriceCarts } from "@/lib/agent/carts";
import { removeItem, setQty, swapItem } from "@/lib/cartState";
import { catalogIndex } from "@/lib/catalog";
import { biryaniCarts, index, products } from "./agentFixtures";

const turn = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  message: "m",
  status: "done",
  stop_reason: "finished",
  reply: "Done.",
  model_calls: 2,
  tool_calls: 3,
  tool_errors: 0,
  latency_ms: 5000,
  cost_usd: 0.006,
  ...over,
});

describe("agent eval checks", () => {
  const start = biryaniCarts();
  const paneer = products.find((p) => p.id === "p001")!;
  const veg = [{ ...swapItem(start[0], "p002", paneer), requirements: { ...start[0].requirements, diet: "veg" as const, must_include: [] } }, start[1], start[2]];

  it("only_changed and unchanged catch edits to the wrong cart", () => {
    expect(runCheck({ only_changed: [1] }, start, veg, "", index)).toEqual([]);
    expect(runCheck({ only_changed: [2] }, start, veg, "", index)).toEqual(["cart 1 changed but shouldn't have"]);
    expect(runCheck({ unchanged: true }, start, start, "", index)).toEqual([]);
    expect(runCheck({ unchanged: true }, start, veg, "", index)).toEqual(["cart 1 changed but nothing should have"]);
  });

  it("diet, contains_any and lacks look only at items that will be ordered", () => {
    expect(runCheck({ diet: [1, "veg"] }, start, veg, "", index)).toEqual([]);
    expect(runCheck({ diet: [2, "veg"] }, start, veg, "", index)).toEqual(["cart 2 has Chicken Curry Cut, which isn't veg"]);
    expect(runCheck({ contains_any: [1, ["tofu", "paneer"]] }, start, veg, "", index)).toEqual([]);
    expect(runCheck({ lacks: [1, ["chicken"]] }, start, veg, "", index)).toEqual([]);
    // Salt is optional and unticked in cart 1, so it isn't ordered.
    expect(runCheck({ lacks: [1, ["salt"]] }, start, start, "", index)).toEqual([]);
  });

  it("checks totals, drops, counts, amounts and replacements", () => {
    expect(runCheck({ max_total: [1, 500] }, start, veg, "", index)).toEqual([]);
    expect(runCheck({ max_total: [1, 300] }, start, veg, "", index)).toEqual(["cart 1 is ₹304, over ₹300"]);
    expect(runCheck({ total_drop_pct: [1, 40] }, start, veg, "", index)).toEqual([]);
    expect(runCheck({ total_drop_pct: [1, 50] }, start, veg, "", index)[0]).toContain("less than 50% cheaper");
    const doubled = [setQty(start[0], "p002", 4), start[1], start[2]];
    expect(runCheck({ qty_ratio: [1, "chicken", 2] }, start, doubled, "", index)).toEqual([]);
    expect(runCheck({ qty_ratio: [1, "chicken", 3] }, start, doubled, "", index)[0]).toContain("wanted ×3");
    const other = products.find((p) => p.id === "p009")!;
    const swapped = [swapItem(start[0], "p004", other), start[1], start[2]];
    expect(runCheck({ replaced: [1, "basmati_rice"] }, start, swapped, "", index)).toEqual([]);
    expect(runCheck({ replaced: [1, "basmati_rice"] }, start, start, "", index)).toEqual(["cart 1 still has the original Basmati Rice"]);
    expect(runCheck({ replaced: [1, "basmati_rice"] }, start, [removeItem(start[0], "p004"), start[1], start[2]], "", index)).toEqual(["cart 1 has no basmati_rice left"]);
    expect(runCheck({ item_count: [1, "chicken", 1] }, start, start, "", index)).toEqual([]);
  });

  it(`"=kind" means the exact sub-category, so poha isn't counted as rice`, () => {
    const poha = { ...products[3], id: "p050", name: "Poha - Flattened & Beaten Rice", sub_category: "poha" };
    const idx = new Map([...index, ["p050", poha]]);
    const withPoha = [{ ...start[0], items: [...removeItem(start[0], "p004").items, { ...start[0].items[1], product_id: "p050", name: poha.name, sub_category: "poha" }] }, start[1], start[2]];
    expect(runCheck({ lacks: [1, ["rice"]] }, start, withPoha, "", idx)).toEqual(["cart 1 still has Poha - Flattened & Beaten Rice"]);
    expect(runCheck({ lacks: [1, ["=rice", "=basmati_rice"]] }, start, withPoha, "", idx)).toEqual([]);
  });

  it("checks recorded requirements and the reply", () => {
    expect(runCheck({ requirement: [1, "diet", "veg"] }, start, veg, "", index)).toEqual([]);
    expect(runCheck({ requirement: [2, "diet", "veg"] }, start, veg, "", index)).toEqual(["cart 2 diet is none, not veg"]);
    expect(runCheck({ reply_any: ["can't", "too low"] }, start, start, "Sorry, ₹50 is too low for pav bhaji.", index)).toEqual([]);
    expect(runCheck({ reply_any: ["can't"] }, start, start, "Done!", index)[0]).toContain("mentions none of");
  });
});

describe("scoreScenario", () => {
  const s: AgentScenario = { id: "x", group: "diet", carts: "c", active: 1, turns: ["make it veg"], checks: [{ only_changed: [1] }, { diet: [1, "veg"] }] };

  it("fails a scenario when a turn gave up, and flags wrong-cart edits", () => {
    const start = biryaniCarts();
    const gaveUp = scoreScenario(s, start, start, [turn({ status: "gave_up", stop_reason: "tool_limit" })], index);
    expect(gaveUp.passed).toBe(false);
    expect(gaveUp.failures[0]).toBe("turn 1 gave up (tool_limit)");
    const wrong = scoreScenario({ ...s, checks: [{ only_changed: [2] }] }, start, [setQty(start[0], "p003", 2), start[1], start[2]], [turn()], index);
    expect(wrong.wrong_carts).toBe(true);
  });

  it("counts rule problems in carts that changed", () => {
    const start = biryaniCarts();
    const broken = [{ ...setQty(start[0], "p003", 2), requirements: { ...start[0].requirements, budget_inr: 100 } }, start[1], start[2]];
    const score = scoreScenario({ ...s, checks: [] }, start, broken, [turn()], index);
    expect(score.rule_breaks).toBe(1);
    expect(score.passed).toBe(false);
  });
});

describe("summary and gate", () => {
  const score = (passed: boolean, over: Partial<ScenarioScore> = {}): ScenarioScore => ({ id: `s${Math.random()}`, group: "diet", passed, failures: [], rule_breaks: 0, wrong_carts: false, turns: [turn()], ...over });

  it("summarises success, groups and per-turn numbers", () => {
    const sum = summariseAgent([score(true), score(false, { group: "question", wrong_carts: true }), score(true, { turns: [turn(), turn({ tool_calls: 5, tool_errors: 2 })] })]);
    expect(sum).toMatchObject({ scenarios: 3, passed: 2, wrong_cart_scenarios: 1, no_change_ok: "0 of 1", turns: 4, tool_calls_per_turn: 3.5, tool_errors_per_turn: 0.5 });
    expect(sum.by_group).toEqual({ diet: "2/2", question: "0/1" });
  });

  it("passes at the baseline, allows one extra failure, and never allows rule breaks", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const base = summariseAgent([true, true, true, true, true, false].map((p) => score(p)));
    const baseline = { updated: "2026-11-09T00:00:00Z", model: "m", ids, summary: base };
    const run = (passes: boolean[], extra: Partial<ScenarioScore> = {}) => checkAgentGate(summariseAgent(passes.map((p) => score(p, extra))), ids, "m", baseline);
    expect(run([true, true, true, true, true, false]).pass).toBe(true);
    expect(run([true, true, true, true, false, false]).pass).toBe(true);
    expect(run([true, true, true, false, false, false]).pass).toBe(false);
    expect(run([true, true, true, true, true, true], { rule_breaks: 1 }).pass).toBe(false);
    expect(checkAgentGate(base, ["a"], "m", baseline).checks[0].ok).toBe(false);
  });
});

describe("the scenarios themselves", () => {
  const scenarios = scenariosJson as AgentScenario[];
  const snapshots = cartsJson as Record<string, { carts: unknown }>;

  it("have unique IDs, known starting carts and 6 in the CI subset", () => {
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
    for (const s of scenarios) expect(Object.keys(snapshots), s.id).toContain(s.carts);
    expect(scenarios.filter((s) => s.ci)).toHaveLength(6);
  });

  it("each ask for a real change: some check fails on the untouched carts (except no-change ones)", () => {
    const vacuous: string[] = [];
    for (const s of scenarios) {
      const start = repriceCarts(CartsInputSchema.parse(snapshots[s.carts].carts), catalogIndex).carts;
      const expectsNoChange = s.checks.some((c) => "unchanged" in c);
      const failsOnStart = s.checks.some((c) => runCheck(c, start, start, "", catalogIndex).length > 0);
      if (!expectsNoChange && !failsOnStart) vacuous.push(s.id);
    }
    expect(vacuous).toEqual([]);
  });
});
