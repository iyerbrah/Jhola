import { describe, expect, it } from "vitest";
import { checkCart, toCartItem, type AgentCart } from "@/lib/agent/carts";
import { suggestionsFor } from "@/lib/agent/client";
import { cartView, fitDiet, runTool, type AgentState } from "@/lib/agent/tools";
import { fitsDiet } from "@/lib/requirements";
import { isFood } from "@/lib/schema";
import { runCheck } from "@/evals/agentScore";
import { biryaniCarts, deps, index, none } from "./agentFixtures";

// p010 is a dishwashing liquid: not food, no diet tags.
const dishwash = index.get("p010")!;
const withDishwash = (diet: AgentCart["requirements"]["diet"]): AgentCart => ({
  name: "Classic",
  reason: "",
  items: [toCartItem(index.get("p001")!, 2, false, true), toCartItem(dishwash, 1, false, true)],
  requirements: { ...none, diet },
});

describe("diets apply to food only", () => {
  it("non-food fits every diet; food needs the tag", () => {
    expect(isFood(dishwash)).toBe(false);
    expect((["veg", "vegan", "jain"] as const).every((d) => fitsDiet(dishwash, d))).toBe(true);
    expect(fitsDiet(index.get("p002")!, "veg")).toBe(false);
  });

  it("a vegetarian or Jain cart with dishwash liquid passes the rules", () => {
    expect(checkCart(withDishwash("veg"), index)).toEqual([]);
    expect(checkCart(withDishwash("jain"), index)).toEqual([]);
  });

  it("fit_diet leaves non-food alone", () => {
    const { swapped, left } = fitDiet(withDishwash("vegan"), deps);
    // Paneer isn't vegan and has no vegan twin; the dishwash liquid isn't touched or listed.
    expect(swapped).toEqual([]);
    expect(left.map((p) => p.id)).toEqual(["p001"]);
  });

  it("search with a diet still finds non-food", async () => {
    const hits = await deps.search.search({ text: "dishwash", diet: "jain" });
    expect(hits.map((h) => h.id)).toEqual(["p010"]);
    expect(hits[0].tags).toEqual(["non_food"]);
  });

  it("the agent sees non-food marked as such", () => {
    expect(cartView(withDishwash("veg"), 0, index)).toContain("| dishwash | non_food");
  });

  it("the agent eval's diet check skips non-food", () => {
    const c = withDishwash("veg");
    expect(runCheck({ diet: [1, "veg"] }, [c], [c], "", index)).toEqual([]);
  });

  it("adding soap to a vegetarian cart is fine", async () => {
    const state: AgentState = { carts: biryaniCarts(), active: 0, version: 0, touched: new Set() };
    state.carts[0] = { ...state.carts[0], requirements: { ...none, diet: "veg" }, items: state.carts[0].items.filter((it) => it.product_id !== "p002") };
    const r = await runTool("add_item", JSON.stringify({ cart: 1, product_id: "p010", qty: 1, done: true }), state, deps);
    expect(r.ok).toBe(true);
    expect(state.carts[0].items.some((it) => it.product_id === "p010")).toBe(true);
  });
});

describe("suggestion chips", () => {
  it("don't offer vegetarian for a cart whose only non-veg-tagged item isn't food", () => {
    const veg = { ...withDishwash(null), items: [toCartItem(index.get("p003")!, 1, false, true), toCartItem(dishwash, 1, false, true)] };
    expect(suggestionsFor(veg)).not.toContain("Make it vegetarian");
  });

  it("offer something missed, not dessert, for a cart with no food", () => {
    const cleaning = { ...withDishwash(null), items: [toCartItem(dishwash, 2, false, true)] };
    expect(suggestionsFor(cleaning)).toContain("Add anything I've missed");
    expect(suggestionsFor(cleaning)).not.toContain("Add something for dessert");
  });
});
