/**
 * Every eval chat must be fair to the agent: some cart from the real grocery catalogue could pass its checks.
 * And the catalogue facts those checks lean on (what food contains, what's sugar free) must be right, or the
 * eval would reward a wrong cart or punish a right one.
 */
import { describe, expect, it } from "vitest";
import { catalog } from "@/lib/catalog";
import { allScenarios } from "@/evals/chatScenarios";
import { feasibility } from "@/evals/suiteCheck";
import type { ChatScenario } from "@/evals/chatScore";
import { isFood } from "@/lib/schema";

describe.each(["final", "goal", "core"] as const)("the %s suite against the grocery catalogue", (suite) => {
  it("has no chat that no cart could pass: every item, brand, amount, count and budget is achievable", () => {
    const bad = allScenarios(suite).flatMap((s) => feasibility(s, catalog).map((p) => `${s.id}: ${p}`));
    expect(bad).toEqual([]);
  }, 60_000); // solves every chat of the suite against the whole catalogue: seconds on a CI runner
});

describe("the feasibility check itself", () => {
  it("catches a chat the catalogue can't serve", () => {
    const impossible: ChatScenario = {
      id: "x",
      group: "everyday",
      start: null,
      turns: ["x"],
      not_sold: ["milk"],
      checks: [{ diet: "vegan" }, { covers: [["=milk"], ["=caviar"]] }, { brands_any: [["no such brand"]] }, { amount_range: ["=salt", 7, 9] }, { pieces_min: ["=eggs", 500] }, { ready: { allow_unmet: ["paneer"] } }],
    };
    const problems = feasibility(impossible, catalog).join("\n");
    for (const p of [/covers: nothing vegan.*=milk/, /=caviar/, /brands_any/, /amount_range/, /pieces_min/, /"paneer" is allowed to be missing, but the store sells/, /not_sold: the store does sell "milk"/]) expect(problems).toMatch(p);
  });

  it("catches a budget below the cheapest cart for the items it requires", () => {
    const tooCheap: ChatScenario = { id: "x", group: "budget", start: null, turns: ["x"], checks: [{ ready: true }, { max_total: 30 }, { covers: [["=ghee"], ["=basmati_rice"]] }] };
    expect(feasibility(tooCheap, catalog).join(" ")).toMatch(/budget: the cheapest product for each required item adds up to/);
  });
});

describe("catalogue facts the eval relies on", () => {
  const food = catalog.filter(isFood);
  it("doesn't mark food as dairy because of a word inside another word ('Classic' isn't 'lassi')", () => {
    expect(food.filter((p) => p.contains?.includes("dairy") && /classic/i.test(p.name) && !/\b(milk|butter|cheese|cream|ghee|paneer|malai|curd|dahi)/i.test(p.name) && !["biscuits", "chocolate", "cake", "ice_cream", "sweets", "health_drinks", "flavoured_milk", "baby_food", "choco_spread", "mayonnaise"].includes(p.sub_category)).map((p) => p.name)).toEqual([]);
  });

  it("doesn't give spice mixes the allergens of the dish they're for (paneer masala has no paneer)", () => {
    expect(food.filter((p) => p.category === "masalas_spices" && p.contains?.some((c) => c !== "gluten")).map((p) => p.name)).toEqual([]);
    expect(food.filter((p) => p.category === "masalas_spices" && p.contains?.includes("gluten") && !/compounded/i.test(p.name)).map((p) => p.name)).toEqual([]);
  });

  it("keeps plant milks and nut butters out of dairy", () => {
    expect(food.filter((p) => /almond (milk|drink|butter)|soy[a]? (milk|drink)|oat (milk|drink)|coconut milk/i.test(p.name) && p.contains?.includes("dairy")).map((p) => p.name)).toEqual([]);
  });

  it("calls only genuinely sugar-free products sugar free: no fruit juice, sugarcane or coconut water", () => {
    expect(food.filter((p) => p.tags.includes("sugar_free") && ["juice", "coconut_water"].includes(p.sub_category)).map((p) => p.name)).toEqual([]);
  });
});
