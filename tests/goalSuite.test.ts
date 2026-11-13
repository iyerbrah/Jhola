/**
 * The goal suite (evals/goal/scenarios.json): chats that must each end with a grocery cart ready to order.
 * Playing them needs the real model (npm run eval:chat -- --suite=goal); these tests check, for free, that
 * the suite is well formed and that "ready to order" means what it says.
 */
import { describe, expect, it } from "vitest";
import { catalog, catalogIndex } from "@/lib/catalog";
import { solveSession, type ChatTurnResult } from "@/lib/chat/loop";
import { emptySession } from "@/lib/chat/session";
import type { Need, Session } from "@/lib/cart/types";
import { allScenarios, setUp } from "@/evals/chatScenarios";
import { readyToOrder, scoreChat, type ChatScenario } from "@/evals/chatScore";

const goal = allScenarios("goal");

describe("the goal suite", () => {
  it("is big and varied: everyday shopping, recipes, occasions, diets, budgets, conversations and rare requests", () => {
    expect(goal.length).toBeGreaterThanOrEqual(75);
    const groups = new Map<string, number>();
    for (const s of goal) groups.set(s.group, (groups.get(s.group) ?? 0) + 1);
    for (const g of ["everyday", "recipe", "occasion", "household", "personal", "dietary", "budget", "conversation", "rare"]) expect(groups.get(g) ?? 0, g).toBeGreaterThanOrEqual(4);
    expect(goal.filter((s) => s.turns.length > 1).length).toBeGreaterThanOrEqual(8);
  });

  it("has ids unique across every suite, all marked as the goal suite", () => {
    const ids = allScenarios().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(goal.every((s) => s.id.startsWith("goal-") && s.suite === "goal")).toBe(true);
  });

  it("asks every chat for a cart ready to order, except a request the store can't serve", () => {
    const missing = goal.filter((s) => !s.checks.some((c) => "ready" in c || "empty" in c)).map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it("checks something specific in every chat, beyond being ready", () => {
    const vague = goal.filter((s) => s.checks.filter((c) => !("ready" in c)).length === 0).map((s) => s.id);
    expect(vague).toEqual([]);
  });

  it("starts every chat empty, as a shopper would", () => {
    for (const s of goal) {
      const setup = setUp(s, catalog);
      expect(setup.start.session.needs, s.id).toEqual([]);
    }
  });

  it("puts about a quarter of the chats in the PR check, from every group", () => {
    const ci = goal.filter((s) => s.ci);
    expect(ci.length).toBeGreaterThanOrEqual(15);
    expect(ci.length).toBeLessThanOrEqual(25);
    expect(new Set(ci.map((s) => s.group)).size).toBeGreaterThanOrEqual(7);
  });
});

/** A finished turn whose session is `s`, solved against the real catalogue, as the agent loop returns it. */
function result(s: Session, extra: Partial<ChatTurnResult> = {}): ChatTurnResult {
  const solved = solveSession(s, { products: catalog, index: catalogIndex });
  return {
    status: "done",
    stop_reason: "finished",
    reply: "Here's your cart.",
    question: null,
    session: solved.session,
    cart: solved.cart,
    checks: solved.checks,
    diff: { added: [], removed: [], changed: [], swapped: [] } as unknown as ChatTurnResult["diff"],
    note: [],
    pending: null,
    meta: { trace_id: "t", finished_by: "code", model: "m", model_calls: 1, tool_calls: 1, latency_ms: 1000, cost_usd: 0.004, cost_inr: 0.35, steps: [], input_tokens: 0, cached_tokens: 0, output_tokens: 0 },
    ...extra,
  } as ChatTurnResult;
}

const need = (id: string, kind: string, amount: number, unit: Need["unit"], o: Partial<Need> = {}): Need => ({
  id, group: "g", label: id, kind, amount, unit, per_person: false, role: "core", ticked: true, count: null, prefer: null, why: "", confidence: "sure", ...o,
});
const base = emptySession();
const breakfast: Session = {
  ...base,
  brief: { ...base.brief, summary: "Breakfast for 2", people: 2, plan: ["milk 1 L", "bread 1 pack", "eggs 6 pcs"] },
  needs: [need("milk", "milk", 1000, "ml"), need("bread", "bread", 1, "pack"), need("eggs", "eggs", 6, "pcs")],
};

describe("ready to order", () => {
  it("is a finished turn whose cart passes every check and holds everything planned", () => {
    expect(readyToOrder(result(breakfast), catalogIndex)).toEqual([]);
  });

  it("isn't, when the turn waits for a yes or gave up", () => {
    expect(readyToOrder(result(breakfast, { status: "confirm", stop_reason: "confirm" as ChatTurnResult["stop_reason"] }), catalogIndex)[0]).toMatch(/ended confirm/);
  });

  it("isn't, with an empty cart", () => {
    expect(readyToOrder(result({ ...base, brief: { ...base.brief, summary: "x" } }), catalogIndex)).toContain("the cart is empty");
  });

  it("isn't, when a line is out of stock or priced differently from the catalogue", () => {
    const r = result(breakfast);
    const milk = r.cart.lines.find((l) => l.need_id === "milk")!;
    const stale = { ...r, cart: { ...r.cart, lines: r.cart.lines.map((l) => (l === milk ? { ...l, product: { ...l.product, price: l.product.price + 5 } } : l)) } };
    expect(readyToOrder(stale, catalogIndex).join(" ")).toMatch(/not orderable as listed/);
  });

  it("isn't, when the cart breaks the shopper's diet or allergy", () => {
    const veg = { ...breakfast, brief: { ...breakfast.brief, diet: "vegan" as const } };
    const r = result(breakfast);
    // The cart built without the diet, judged against a vegan brief: milk and eggs break it.
    expect(readyToOrder({ ...r, session: { ...r.session, brief: veg.brief } }, catalogIndex).join(" ")).toMatch(/checklist: Not vegan/);
  });

  it("isn't, when a planned item never became a need", () => {
    const planned = { ...breakfast, brief: { ...breakfast.brief, plan: [...breakfast.brief.plan, "orange juice 1 L"] } };
    expect(readyToOrder(result(planned), catalogIndex).join(" ")).toMatch(/planned but not in the cart: orange juice/);
  });

  it("isn't, when a core item has no product, unless the store doesn't sell it, the scenario allows it and the note says so", () => {
    const withWine = { ...breakfast, needs: [...breakfast.needs, need("wine", "red_wine", 750, "ml", { label: "Red wine" })] };
    const r = result(withWine, { note: ["Couldn't add red wine: the store has nothing that counts as red wine."] });
    expect(readyToOrder(r, catalogIndex).join(" ")).toMatch(/no product for red wine/);
    expect(readyToOrder(r, catalogIndex, ["wine"])).toEqual([]);
  });

  it("scores as one check, in its own failure category", () => {
    const s: ChatScenario = { id: "x", group: "everyday", start: null, turns: ["milk, bread and eggs"], checks: [{ ready: true }] };
    const bad = result({ ...base, brief: { ...base.brief, summary: "x" } });
    const score = scoreChat(s, [{ message: s.turns[0], before: solveSession(base, { products: catalog, index: catalogIndex }), result: bad }], catalogIndex);
    expect(score.passed).toBe(false);
    expect(score.failures.map((f) => f.category)).toEqual(["not_ready"]);
  });
});
