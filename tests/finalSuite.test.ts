/**
 * The final eval (evals/final/suite.json): THE eval for Jhola's goal, a grocery cart ready to order from a
 * chat. Playing it needs the real model (npm run eval:chat, capped at $1.50); these tests check for free that
 * it covers every capability more than once, stays under its budget, and fits the real catalogue.
 */
import { describe, expect, it } from "vitest";
import { catalog } from "@/lib/catalog";
import { allScenarios, FINAL, setUp } from "@/evals/chatScenarios";
import { EST_USD_PER_TURN, FINAL_CAP_USD, type ChatCheck, type ChatScenario } from "@/evals/chatScore";

const final = allScenarios("final");
const turns = final.reduce((n, s) => n + s.turns.length, 0);
const has = (s: ChatScenario, key: string) => s.checks.some((c: ChatCheck) => key in c);
const count = (ok: (s: ChatScenario) => boolean) => final.filter(ok).length;
const said = (s: ChatScenario, re: RegExp) => s.turns.some((t) => re.test(t));

/**
 * What the agent must be able to do, and how many different chats must test it. Each capability is tested
 * at least twice, in different words or situations, so one lucky (or unlucky) chat can't decide it.
 */
const CAPABILITIES: [name: string, min: number, test: (s: ChatScenario) => boolean][] = [
  // Building a cart from a new chat
  ["a shopping list, by name", 3, (s) => s.group === "everyday" && has(s, "covers")],
  ["exact amounts (g, kg, litres)", 3, (s) => has(s, "amount_range") && s.start == null],
  ["counted items (a dozen, 2 cabbages)", 2, (s) => has(s, "pieces_min")],
  ["an amount of money (₹200 of vegetables)", 2, (s) => has(s, "budget_use_min")],
  ["a single item", 1, (s) => s.id === "f-list-single-item"],
  ["recipes, from several regions", 6, (s) => s.group === "recipe"],
  ["occasions and parties, small to very large", 4, (s) => s.group === "occasion"],
  ["household and cleaning", 2, (s) => s.group === "household"],
  ["personal care, baby and pet", 3, (s) => s.group === "personal"],
  ["several errands in one message", 2, (s) => s.id === "f-home-mixed-errands" || s.id === "f-convo-sandwich-adds" || said(s, /cleaning stuff|cat food/)],
  // What the shopper can and can't eat
  ["a diet (vegan, jain, vegetarian)", 4, (s) => has(s, "diet")],
  ["an allergy or intolerance, kept out by what food contains", 4, (s) => has(s, "brief_avoid")],
  ["a standing preference (organic, diabetic, protein)", 3, (s) => has(s, "brief_prefer")],
  ["a word rule (no onions, no chillies)", 3, (s) => has(s, "rule_holds") || s.checks.some((c) => "lacks" in c && c.lacks.some((w) => /onion|chilli/.test(w)))],
  // Money
  ["a budget that fits", 3, (s) => has(s, "budget_honest") && !said(s, /₹1[02]0\b/)],
  ["a budget that can't be met, said honestly", 2, (s) => has(s, "budget_honest") && said(s, /₹1[02]0\b/)],
  ["cheaper, on request", 2, (s) => has(s, "cheaper_by") || said(s, /cheaper/)],
  // How people really type
  ["typos, Hinglish, emoji, rambling", 4, (s) => s.group === "rare" && /typos|hinglish|emoji|rambling/.test(s.id)],
  ["named brands", 3, (s) => has(s, "brands_any")],
  ["a pasted list", 1, (s) => s.id === "f-list-pasted"],
  // What the store can't do
  ["nothing the store sells", 2, (s) => has(s, "empty")],
  ["part of the request not sold, the rest built", 2, (s) => s.checks.some((c) => "ready" in c && c.ready !== true)],
  ["a contradiction (vegan paneer)", 1, (s) => s.id === "f-cant-vegan-paneer"],
  ["checkout, payment, discounts, other shops' products", 3, (s) => s.id.startsWith("f-refuse-")],
  // Editing a saved cart
  ["editing a saved cart", 10, (s) => s.group === "edit"],
  ["edits that change nothing else", 6, (s) => has(s, "collateral_max")],
  ["edits on different starting carts", 4, (s) => s.group === "edit" && s.start != null],
  ["a diet or allergy added to a saved cart", 3, (s) => s.group === "diet"],
  // Over several messages
  ["rules and allergies remembered over later messages", 5, (s) => s.group === "memory"],
  ["a rule lifted or undone by the shopper", 2, (s) => /lifted|undo/.test(s.id)],
  ["conversations that build a cart step by step", 4, (s) => s.group === "conversation"],
  ["chats of three messages", 4, (s) => s.turns.length >= 3],
  // Stock
  ["a sold-out product: fair stand-in, kept pin, or none left", 3, (s) => s.group === "stock"],
  // Questions both ways
  ["the shopper asks about the cart; nothing changes", 3, (s) => s.group === "question" && has(s, "unchanged")],
  ["the agent asks when the request is unclear, then uses the answer", 3, (s) => has(s, "asked_on_turn") && s.turns.length > 1 && has(s, "ready")],
  ["the agent asks when the request is too vague to start", 1, (s) => s.checks.some((c) => "asked_question" in c && c.asked_question === true)],
  ["the agent doesn't ask when the request is clear", 3, (s) => s.checks.some((c) => "asked_question" in c && c.asked_question === false)],
  // Safety and big changes
  ["prompt injection, in the message and in a listing", 3, (s) => s.group === "safety"],
  ["big changes wait for the shopper's yes", 3, (s) => has(s, "status")],
  // The goal and efficiency
  ["the chat ends with a cart ready to order", 60, (s) => has(s, "ready")],
  ["simple edits stay quick", 1, (s) => has(s, "model_calls_max")],
];

describe("the final eval", () => {
  it(`costs under $${FINAL_CAP_USD} to run, with room to spare, and isn't trimmed so far that it stops covering things`, () => {
    expect(turns * EST_USD_PER_TURN).toBeLessThan(FINAL_CAP_USD * 0.95);
    expect(turns).toBeGreaterThanOrEqual(110);
    expect(final.length).toBeGreaterThanOrEqual(100);
  });

  it.each(CAPABILITIES)("tests %s (at least %i chats)", (_name, min, test) => {
    expect(count(test)).toBeGreaterThanOrEqual(min);
  });

  it("has unique ids, all marked as the final suite, and no two chats with the same messages and start", () => {
    const ids = final.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(final.every((s) => s.id.startsWith("f-") && s.suite === "final")).toBe(true);
    const keys = final.map((s) => `${s.start}|${s.turns.join("|")}|${s.out_of_stock ?? ""}|${s.sold_out_kind ?? ""}|${s.pin ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("checks something specific in every chat", () => {
    expect(final.filter((s) => s.checks.filter((c) => !("ready" in c)).length === 0).map((s) => s.id)).toEqual([]);
  });

  it("puts about a third of the chats in the PR check, from nearly every group", () => {
    const ci = final.filter((s) => s.ci);
    expect(ci.length).toBeGreaterThanOrEqual(25);
    expect(ci.length).toBeLessThanOrEqual(40);
    expect(new Set(ci.map((s) => s.group)).size).toBeGreaterThanOrEqual(14);
    expect(ci.reduce((n, s) => n + s.turns.length, 0) * EST_USD_PER_TURN).toBeLessThan(0.6);
  });

  it("describes itself, and sets up every chat against the real catalogue", () => {
    expect(FINAL.about).toMatch(/order it as it is|could order/);
    for (const s of final) expect(() => setUp(s, catalog), s.id).not.toThrow();
  });
});
