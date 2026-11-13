import { describe, expect, it } from "vitest";
import { catalog, catalogIndex } from "@/lib/catalog";
import { solveSession, type ChatTurnResult, type Solved } from "@/lib/chat/loop";
import { diffCarts } from "@/lib/cart/diff";
import { toLineProduct, type Session } from "@/lib/cart/types";
import { packLabel } from "@/lib/schema";
import { allScenarios, fromQuery, setUp } from "@/evals/chatScenarios";
import { lineMatches, scoreChat, summariseChat, type ChatScenario, type TurnOutcome } from "@/evals/chatScore";
import { checkChatGate, renderChatReport } from "@/evals/chatGate";

const KNOWN = ["status", "covers", "contains_any", "lacks", "diet", "max_total", "cheaper_by", "budget_honest", "rule_holds", "amount_range", "replaces_amount", "count", "count_any", "budget_use_min", "people", "collateral_max", "unchanged", "kept", "substituted", "asked_question", "note_mentions", "reply_any", "injection_ignored", "model_calls_max", "empty", "lacks_contains", "brief_avoid", "brief_prefer", "prefer_met", "brands_any", "pieces_min", "ready", "asked_on_turn"];

describe("the scenarios", () => {
  const all = allScenarios();
  it("are about 80, with unique ids and only known checks", () => {
    expect(all.length).toBeGreaterThanOrEqual(80);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) for (const c of s.checks) expect(KNOWN).toContain(Object.keys(c)[0]);
  });

  it("names only words that match real in-stock products, so a check can't pass or fail for want of data", () => {
    const lines = catalog.filter((p) => p.in_stock).map((p) => ({ product: toLineProduct(p, packLabel(p)) }));
    const words = (c: Record<string, unknown>): string[] => {
      const [k, v] = Object.entries(c)[0] as [string, unknown];
      if (k === "covers") return (v as string[][]).flat();
      if (k === "contains_any" || k === "lacks") return v as string[];
      if (k === "rule_holds") return [v as string];
      if (k === "count" || k === "amount_range" || k === "pieces_min") return [(v as [string])[0]];
      if (k === "count_any") return (v as [string[]])[0];
      return [];
    };
    const unknown = new Set<string>();
    for (const s of all) for (const c of s.checks) for (const w of words(c)) if (!lines.some((l) => lineMatches(l, w))) unknown.add(`${s.id}: ${w}`);
    expect([...unknown]).toEqual([]);
  });

  it("every one sets up against the real catalog, and its starting cart passes its own rules", () => {
    for (const s of all) {
      const setup = setUp(s, catalog);
      expect(setup.start.checks.filter((c) => c.status === "fail"), s.id).toEqual([]);
    }
  });

  it("a stock-out scenario sells out the start product; a pin scenario pins it", () => {
    const oos = setUp(all.find((s) => s.id === "stock-cheese-sold-out")!, catalog);
    const cheese = oos.start.cart.lines.find((l) => l.need_id === "cheese")!;
    expect(oos.index.get(cheese.product.id)!.in_stock).toBe(false);
    expect(solveSession(oos.start.session, oos).cart.lines.find((l) => l.need_id === "cheese")!.substitution).toMatchObject({ wanted: { id: cheese.product.id } });
    // Every fresh cream sells out: there's no stand-in, and the cart says so instead of adding a biscuit.
    const only = setUp(all.find((s) => s.id === "stock-only-option-sold-out")!, catalog);
    const after = solveSession(only.start.session, only).cart;
    expect(after.lines.some((l) => l.need_id === "cream")).toBe(false);
    expect(after.unmet.map((u) => u.need_id)).toEqual(["cream"]);
    const pin = setUp(all.find((s) => s.id === "pin-kept-cheaper")!, catalog);
    expect(pin.start.session.pins.map((p) => p.need_id)).toEqual(["pasta"]);
  });

  it("ports each cart builder query with its expectations", () => {
    expect(fromQuery({ group: "edge", query: "a laptop", expected_status: "cannot_fulfil", ci: true })).toMatchObject({ checks: [{ empty: true }], ci: true, start: null });
    expect(fromQuery({ group: "budget_gift", query: "4 dark chocolates under 1000", expected_status: "ok", budget_inr: 1000, item_count: 4, item_kind: "dark_chocolate" }).checks).toEqual([{ budget_honest: 1000 }, { count: ["dark_chocolate", 4] }]);
  });
});

/** A finished turn that ends in this session, as the real loop would return it. */
function turn(message: string, before: Solved, after: Session, extra: Partial<ChatTurnResult> = {}): TurnOutcome {
  const s = solveSession(after, { products: catalog, index: catalogIndex });
  return {
    message,
    before,
    result: {
      status: "done",
      stop_reason: "finished",
      reply: "Done.",
      question: null,
      session: s.session,
      cart: s.cart,
      checks: s.checks,
      diff: diffCarts(before.cart, s.cart),
      note: [],
      pending: null,
      meta: { trace_id: "t", finished_by: "code", model: "gpt-5.4-mini", model_calls: 1, tool_calls: 2, latency_ms: 2000, cost_usd: 0.004, cost_inr: 0.35, steps: [], input_tokens: 0, cached_tokens: 0, output_tokens: 0 },
      ...extra,
    },
  };
}

describe("scoring", () => {
  const scenario = (id: string) => allScenarios().find((s) => s.id === id)!;
  const start = (id: string) => setUp(scenario(id), catalog).start;

  it("a correct '6 people' edit passes, with no collateral", () => {
    const s = scenario("pasta-6-people");
    const b = start(s.id);
    const score = scoreChat(s, [turn("make it 6 people", b, { ...b.session, brief: { ...b.session.brief, people: 6 } })], catalogIndex);
    expect(score.failures).toEqual([]);
    expect(score).toMatchObject({ passed: true, collateral: 0, rule_breaks: 0 });
  });

  it("catches an edit that changes what wasn't asked", () => {
    const s = scenario("pasta-remove-cheese");
    const b = start(s.id);
    const needs = b.session.needs.filter((n) => n.id !== "cheese" && n.id !== "tomato");
    const score = scoreChat(s, [turn("remove the cheese", b, { ...b.session, needs })], catalogIndex);
    expect(score.passed).toBe(false);
    expect(score.failures.map((f) => f.category)).toEqual(["collateral"]);
    expect(score.collateral).toBe(1);
  });

  it("checks diet, coverage and amounts", () => {
    const s: ChatScenario = { id: "x", group: "diet", start: "chicken_biryani", turns: ["make it vegetarian"], checks: [{ diet: "veg" }, { covers: [["chicken"], ["basmati_rice"]] }, { replaces_amount: ["chicken", ["paneer"], 0.4] }] };
    const b = setUp(s, catalog).start;
    const score = scoreChat(s, [turn("make it vegetarian", b, b.session)], catalogIndex);
    expect(score.failures.map((f) => f.check).sort()).toEqual(["diet", "replaces_amount"]);
    expect(score.coverage).toEqual({ hit: 2, of: 2 });
  });

  it("checks intent: what the brief avoids and prefers, what the cart contains, brands and pieces", () => {
    const s: ChatScenario = {
      id: "x",
      group: "diet",
      start: "breakfast",
      turns: ["no dairy, we buy organic"],
      checks: [{ brief_avoid: ["dairy"] }, { lacks_contains: ["dairy"] }, { brief_prefer: ["organic"] }, { brands_any: [["amul", "mother dairy", "nandini", "heritage"]] }, { pieces_min: ["banana", 4] }, { pieces_min: ["eggs", 100] }],
    };
    const b = setUp(s, catalog).start;
    const fails = scoreChat(s, [turn("no dairy, we buy organic", b, b.session)], catalogIndex).failures.map((f) => f.check);
    // The start cart has milk and butter, no avoid and no preference; it has eggs and bananas, but not 100 eggs.
    expect(fails.sort()).toEqual(["brief_avoid", "brief_prefer", "lacks_contains", "pieces_min"]);
    const fixed = { ...b.session, brief: { ...b.session.brief, avoid: ["dairy" as const], prefer: { labels: ["organic" as const], brands: [] } } };
    const after = scoreChat({ ...s, checks: [{ brief_avoid: ["dairy"] }, { lacks_contains: ["dairy"] }, { brief_prefer: ["organic"] }] }, [turn("no dairy, we buy organic", b, fixed)], catalogIndex);
    expect(after.failures).toEqual([]);
  });

  it("checks how much of the budget a cart uses, and how many different products of a group it has", () => {
    const s: ChatScenario = { id: "x", group: "build", start: "pasta_night", turns: ["more"], checks: [{ budget_use_min: 0.95 }, { count_any: [["pasta", "tomato", "cheese"], 3] }, { count_any: [["pasta", "tomato"], 3] }] };
    const b = setUp(s, catalog).start;
    const score = scoreChat(s, [turn("more", b, b.session)], catalogIndex);
    expect(score.failures.map((f) => f.check)).toEqual(["budget_use_min", "count_any"]);
    expect(score.failures[0].detail).toMatch(/of ₹600 \(\d+%\), wanted ≥ 95%/);
  });

  it("a budget it can't reach passes only when the turn says so", () => {
    const s = scenario("pasta-impossible-budget");
    const b = start(s.id);
    const over = { ...b.session, brief: { ...b.session.brief, budget_inr: 120 } };
    expect(scoreChat(s, [turn("keep it under ₹120", b, over, { reply: "Done." })], catalogIndex).passed).toBe(false);
    expect(scoreChat(s, [turn("keep it under ₹120", b, over, { reply: "I can't get it under ₹120; the lowest is ₹250." })], catalogIndex).passed).toBe(true);
  });

  it("a turn that gave up fails the scenario", () => {
    const s = scenario("question-enough");
    const b = start(s.id);
    const score = scoreChat(s, [turn("is this enough?", b, b.session, { status: "gave_up", stop_reason: "model_limit" })], catalogIndex);
    expect(score.failures[0]).toMatchObject({ category: "gave_up" });
  });

  it("matches words by kind, category or whole word", () => {
    const l = { product: { name: "Fresh Cream", sub_category: "cream", category: "dairy" as const, tags: ["veg"] } } as never;
    expect(lineMatches(l, "cream")).toBe(true);
    expect(lineMatches(l, "dairy")).toBe(true);
    expect(lineMatches(l, "=cream")).toBe(true);
    expect(lineMatches(l, "ice")).toBe(false);
  });
});

describe("summary and gate", () => {
  const s = allScenarios().find((x) => x.id === "pasta-6-people")!;
  const b = setUp(s, catalog).start;
  const score = scoreChat(s, [turn("make it 6 people", b, { ...b.session, brief: { ...b.session.brief, people: 6 } })], catalogIndex);
  const summary = summariseChat([score], [s]);

  it("summarises", () => {
    expect(summary).toMatchObject({ scenarios: 1, passed: 1, task_success: 1, rule_breaks: 0, collateral_free: 1, finished_by_code: 1, cost_per_turn_usd: 0.004 });
  });

  it("fails on a rule break or fewer passes, and reports", () => {
    const base = { updated: "", model: "gpt-5.4-mini", ids: [s.id], summary: { ...summary, passed: 3 } };
    const g = checkChatGate({ ...summary, rule_breaks: 1 }, [s.id], base, "gpt-5.4-mini");
    expect(g.ok).toBe(false);
    expect(g.problems.join(" ")).toMatch(/rule break[^]*passed/);
    expect(renderChatReport(summary, g, [score])).toMatch(/^<!-- jhola-eval -->\n## ❌ Shopping agent eval/);
    expect(checkChatGate(summary, [s.id], { ...base, summary }, "gpt-5.4-mini").ok).toBe(true);
  });
});
