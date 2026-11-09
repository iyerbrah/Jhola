import { describe, expect, it } from "vitest";
import { cartsInScope, namedCarts } from "@/lib/agent/scope";
import { runTool, type AgentState } from "@/lib/agent/tools";
import { biryaniCarts, deps } from "./agentFixtures";

const names = ["Budget Biryani", "Classic Biryani", "Premium Biryani"];
const scope = (message: string, active = 0, previous?: string) => [...cartsInScope(message, names, active, previous)].sort();

describe("cartsInScope", () => {
  it("is the visible cart when the message names none", () => {
    expect(scope("make it vegetarian", 1)).toEqual([1]);
    expect(scope("double the eggs")).toEqual([0]);
    expect(scope("use a different brand of paneer", 2)).toEqual([2]);
  });

  it("is every cart for all / every / both / the others", () => {
    for (const m of ["make all three carts vegetarian", "add bread to every cart", "remove the onion from all of them", "do the same for the others", "both carts please", "update my carts", "all 3 should be veg"]) {
      expect(scope(m), m).toEqual([0, 1, 2]);
    }
  });

  it("is the named carts, by number, position or name", () => {
    expect(scope("make cart 3 vegan")).toEqual([2]);
    expect(scope("change cart two")).toEqual([1]);
    expect(scope("the second one is too pricey")).toEqual([1]);
    expect(scope("swap rice in the last cart")).toEqual([2]);
    expect(scope("make the premium one cheaper")).toEqual([2]);
    expect(scope("copy this to the classic biryani")).toEqual([1]);
    expect(scope("cart 1 and cart 3 should be veg", 1)).toEqual([0, 2]);
  });

  it("doesn't read ordinary words as cart names or 'all'", () => {
    expect(scope("keep it within budget", 2)).toEqual([2]);
    expect(scope("remove all the spices", 1)).toEqual([1]);
    expect(scope("is that all?", 1)).toEqual([1]);
    expect(scope("a premium paneer please", 0)).toEqual([0]);
  });

  it("carries over the previous message's carts when this one names none", () => {
    expect(scope("now make them cheaper", 0, "make all three vegetarian")).toEqual([0, 1, 2]);
    expect(scope("and the potatoes too", 0, "I already have rice")).toEqual([0]);
    expect(scope("and cart 2 as well", 0, "make all three vegetarian")).toEqual([1]);
  });

  it("namedCarts reports nothing for a message without a cart reference", () => {
    expect(namedCarts("add a cucumber", names)).toEqual(new Set());
  });
});

describe("editing tools respect the scope", () => {
  const state = (): AgentState => ({ carts: biryaniCarts(), active: 0, version: 0, touched: new Set(), scope: new Set([0]) });

  it("refuse a cart outside it, with a hint, and change nothing", async () => {
    const s = state();
    for (const [name, args] of [
      ["remove_item", { cart: 2, product_id: "p003" }],
      ["add_item", { cart: 3, product_id: "p001", qty: 1 }],
      ["set_requirements", { cart: 2, diet: "veg", budget_inr: null, drop_must_include: [] }],
    ] as const) {
      const r = await runTool(name, JSON.stringify(args), s, deps);
      expect(r.ok, name).toBe(false);
      expect(r.output).toContain(`the shopper didn't ask to change cart ${args.cart}. Change only cart 1`);
    }
    expect(s.carts).toEqual(biryaniCarts());
  });

  it("still allow looking at any cart", async () => {
    expect((await runTool("check_rules", JSON.stringify({ cart: 3 }), state(), deps)).ok).toBe(true);
    expect((await runTool("remove_item", JSON.stringify({ cart: 1, product_id: "p003" }), state(), deps)).ok).toBe(true);
  });
});
