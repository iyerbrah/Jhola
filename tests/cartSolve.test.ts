import { describe, expect, it } from "vitest";
import { knapsack, picksOf, solve } from "@/lib/cart/solve";
import { review, passes } from "@/lib/cart/review";
import { endNote } from "@/lib/cart/notes";
import { collateral, describeDiff, diffCarts } from "@/lib/cart/diff";
import { cartTotal } from "@/lib/cart/types";
import { indexCatalog } from "@/lib/catalog";
import type { Product } from "@/lib/schema";
import { byName, ctx, need, pastaNeeds, products, session } from "./cartFixtures";

const line = (cart: ReturnType<typeof solve>, needId: string) => cart.lines.find((l) => l.need_id === needId);

describe("solve: amounts and packs", () => {
  it("scales per-person amounts and covers them in whole packs", () => {
    const cart = solve(session([need("pasta", "pasta", 100, "g", { role: "main" })]), ctx);
    const l = line(cart, "pasta")!;
    expect(l.needed).toEqual({ amount: 400, unit: "g" });
    expect(l.packs * l.product.pack_size).toBeGreaterThanOrEqual(400);
    expect(l.packs).toBeGreaterThanOrEqual(1);
  });

  it("assumes 2 people for per-person needs when the brief has no head count", () => {
    const cart = solve(session([need("pasta", "pasta", 100, "g")], { people: null }), ctx);
    expect(line(cart, "pasta")!.needed!.amount).toBe(200);
  });

  it("counts packs directly for a 'pack' need", () => {
    const cart = solve(session([need("dish", "dishwash", 2, "pack", { per_person: false })]), ctx);
    expect(line(cart, "dish")!.packs).toBe(2);
  });

  it("treats g and ml as the same for groceries", () => {
    const cart = solve(session([need("cream", "cream", 200, "g", { per_person: false, prefer: "fresh cream" })]), ctx);
    expect(line(cart, "cream")!.product.unit).toBe("ml");
  });

  it("only counts ticked needs; pantry items are shown unticked", () => {
    const cart = solve(session(pastaNeeds()), ctx);
    const oil = line(cart, "oil")!;
    expect(oil.counted).toBe(false);
    expect(cart.total).toBe(cartTotal(cart.lines));
    expect(cart.lines.filter((l) => l.counted).reduce((s, l) => s + l.line_total, 0)).toBe(cart.total);
  });

  it("warns when the smallest pack is far bigger than the need, only when the unused part costs real money", () => {
    // 15 g from a ₹21 pack of garlic: not worth a warning.
    const cheap = solve(session([need("garlic", "garlic", 15, "g", { per_person: false })]), ctx);
    expect(line(cheap, "garlic")!.warnings).toEqual([]);
    // 25 g from a 200 g pack of cheese: most of a ₹100+ pack unused.
    const costly = solve(session([need("cheese", "cheese", 25, "g", { per_person: false })]), ctx);
    expect(line(costly, "cheese")!.warnings.join()).toMatch(/only comes in 200 g/);
  });
});

describe("solve: choosing products", () => {
  it("narrows a broad kind with the need's preference words", () => {
    const cart = solve(session([need("cream", "cream", 30, "ml", { prefer: "fresh cream" })]), ctx);
    expect(line(cart, "cream")!.product.name).toBe("Fresh Cream");
  });

  it("value picks cheaper per unit than premium", () => {
    const value = solve(session([need("pasta", "pasta", 100, "g", { prefer: "penne" })], { quality: "value" }), ctx);
    const premium = solve(session([need("pasta", "pasta", 100, "g", { prefer: "penne" })], { quality: "premium" }), ctx);
    const unit = (c: typeof value) => line(c, "pasta")!.product.price / line(c, "pasta")!.product.pack_size;
    expect(unit(value)).toBeLessThan(unit(premium));
  });

  it("explains each pick with the options it compared", () => {
    const cart = solve(session([need("pasta", "pasta", 100, "g")]), ctx);
    const l = line(cart, "pasta")!;
    expect(l.picked.compared[0].product_id).toBe(l.product.id);
    expect(l.picked.compared.length).toBeGreaterThan(1);
    expect(l.picked.compared.every((o) => o.in_stock)).toBe(true);
    expect(l.picked.rule).toBeTruthy();
  });

  it("gives a count need N different products", () => {
    const cart = solve(session([need("choc", "dark_chocolate", 1, "pack", { per_person: false, count: 3, role: "main" })], { people: null }), ctx);
    const ids = cart.lines.map((l) => l.product.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("reports a need nothing can fill instead of guessing", () => {
    const cart = solve(session([need("nori", "nori_sheets", 1, "pack")]), ctx);
    expect(cart.lines).toHaveLength(0);
    expect(cart.unmet[0]).toMatchObject({ need_id: "nori", reason: "unknown_kind" });
  });
});

describe("solve: diet and rules are hard", () => {
  it("never picks a product that breaks the diet", () => {
    const cart = solve(session([need("protein", "chicken", 150, "g")], { diet: "veg" }), ctx);
    expect(cart.lines).toHaveLength(0);
    expect(cart.unmet[0].reason).toBe("none_fit_diet");
  });

  it("diets apply to food only: dishwash fits a vegan cart", () => {
    const cart = solve(session([need("dish", "dishwash", 1, "pack", { per_person: false })], { diet: "vegan" }), ctx);
    expect(line(cart, "dish")).toBeTruthy();
  });

  it("'no onions' excludes onion products, even in another kind", () => {
    const cart = solve(session([need("tomato", "tomato", 50, "g", { per_person: false })], { rules: [{ kind: "exclude_word", value: "onion", label: "No onions" }], quality: "premium" }), ctx);
    expect(line(cart, "tomato")!.product.name).not.toMatch(/onion/i);
  });

  it("excludes a brand", () => {
    const cart = solve(session([need("cream", "cream", 100, "ml", { per_person: false, prefer: "fresh cream" })], { rules: [{ kind: "exclude_brand", value: "amul", label: "No Amul" }] }), ctx);
    expect(line(cart, "cream")!.product.brand).toBe("Mother Dairy");
  });

  it("skips what the shopper already has", () => {
    const cart = solve(session(pastaNeeds(), { rules: [{ kind: "have", value: "garlic", label: "Have garlic" }] }), ctx);
    expect(line(cart, "garlic")).toBeUndefined();
    expect(cart.skipped).toEqual([{ need_id: "garlic", label: "Garlic", rule: "Have garlic", reason: "have" }]);
  });
});

describe("solve: needs a rule leaves out", () => {
  it("a need every product of which breaks a rule is skipped under the rule, not unmet", () => {
    const s = session([need("onion", "onion", 50, "g"), need("tomato", "tomato", 50, "g")], { rules: [{ kind: "exclude_word", value: "onion", label: "No onions" }] });
    const cart = solve(s, ctx);
    expect(cart.unmet).toEqual([]);
    expect(cart.skipped).toEqual([{ need_id: "onion", label: "Onion", rule: "No onions", reason: "rule" }]);
    expect(endNote(s, cart)).toContain("Left out onion (No onions).");
    expect(review(s, cart, ctx.index).find((c) => c.id === "rule:No onions")?.status).toBe("pass");
  });

  it("a pin that breaks a rule is still unmet", () => {
    const onion = byName("Onion");
    const cart = solve(session([need("onion", "onion", 50, "g")], { rules: [{ kind: "exclude_word", value: "onion", label: "No onions" }] }, { pins: [{ need_id: "onion", product_id: onion.id, qty: null }] }), ctx);
    expect(cart.unmet[0].reason).toBe("pin_breaks_rule");
  });
});

describe("solve: units", () => {
  it("a need in pieces takes a product sold by weight when the only ones sold by the piece are sold out", () => {
    const soaps: Product[] = [
      { id: "p800", name: "Try Me Gift Set", brand: "X", category: "personal_care", sub_category: "soap", pack_size: 3, unit: "pcs", price: 300, in_stock: false, tags: [] },
      { id: "p801", name: "Bathing Soap", brand: "Y", category: "personal_care", sub_category: "soap", pack_size: 125, unit: "g", price: 45, in_stock: true, tags: [] },
    ];
    const cart = solve(session([need("soap", "soap", 2, "pcs", { per_person: false })]), { products: soaps, index: indexCatalog(soaps) });
    expect(cart.unmet).toEqual([]);
    expect(cart.lines[0].product.id).toBe("p801");
  });
});

describe("solve: unsure picks and agent choices", () => {
  const cheese = () => need("cheese", "cheese", 50, "g");

  it("marks a close call as uncertain, with the alternatives compared", () => {
    const l = line(solve(session([cheese()]), ctx), "cheese")!;
    expect(l.uncertain).toBe(true);
    expect(l.picked.compared.length).toBeGreaterThan(1);
  });

  it("a need with one possible product is not uncertain", () => {
    expect(line(solve(session([need("onion", "onion", 50, "g")]), ctx), "onion")!.uncertain).toBe(false);
  });

  it("pins and choices are never uncertain", () => {
    const pick = byName("Cheese Slices");
    expect(line(solve(session([cheese()], {}, { pins: [{ need_id: "cheese", product_id: pick.id, qty: null }] }), ctx), "cheese")!.uncertain).toBe(false);
    expect(line(solve(session([cheese()], {}, { choices: { cheese: pick.id } }), ctx), "cheese")!.uncertain).toBe(false);
  });

  it("the agent's choice wins over the default, isn't shown as the shopper's pick, and gives way to a new rule", () => {
    const first = line(solve(session([cheese()]), ctx), "cheese")!;
    const other = first.picked.compared.find((o) => o.product_id !== first.product.id)!;
    const chosen = line(solve(session([cheese()], {}, { choices: { cheese: other.product_id } }), ctx), "cheese")!;
    expect(chosen.product.id).toBe(other.product_id);
    expect(chosen.pinned).toBe(false);
    expect(chosen.picked.rule).not.toBe("Your pick");
    const brand = chosen.product.brand.toLowerCase();
    const ruled = line(solve(session([cheese()], { rules: [{ kind: "exclude_brand", value: brand, label: `No ${chosen.product.brand}` }] }, { choices: { cheese: other.product_id } }), ctx), "cheese")!;
    expect(ruled.product.id).not.toBe(other.product_id);
  });
});

describe("solve: pins, stock and stability", () => {
  it("keeps the shopper's pin and its quantity", () => {
    const pick = byName("Organic Penne");
    const cart = solve(session([need("pasta", "pasta", 100, "g")], {}, { pins: [{ need_id: "pasta", product_id: pick.id, qty: 3 }] }), ctx);
    expect(line(cart, "pasta")).toMatchObject({ pinned: true, packs: 3, product: { id: pick.id } });
    expect(line(cart, "pasta")!.picked.rule).toBe("Your pick");
  });

  it("a pinned product that goes out of stock is replaced by its closest twin, and says so", () => {
    const pick = byName("Fresh Cream", "Amul");
    const oos = products.map((x) => (x.id === pick.id ? { ...x, in_stock: false } : x));
    const cart = solve(session([need("cream", "cream", 30, "ml")], {}, { pins: [{ need_id: "cream", product_id: pick.id, qty: null }] }), { products: oos, index: indexCatalog(oos) });
    const l = line(cart, "cream")!;
    expect(l.product.brand).toBe("Mother Dairy");
    expect(l.substitution).toMatchObject({ wanted: { id: pick.id }, reason: "out_of_stock", delta_inr: 5 });
    expect(endNote(session([need("cream", "cream", 30, "ml")]), cart)[0]).toMatch(/Amul Fresh Cream is out of stock, so I picked Mother Dairy Fresh Cream \(same size, ₹5 more\)/);
  });

  it("a pin that breaks a new rule is reported, not kept", () => {
    const pick = byName("Fresh Cream", "Amul");
    const cart = solve(session([need("cream", "cream", 30, "ml")], { rules: [{ kind: "exclude_brand", value: "amul", label: "No Amul" }] }, { pins: [{ need_id: "cream", product_id: pick.id, qty: null }] }), ctx);
    expect(cart.unmet[0].reason).toBe("pin_breaks_rule");
  });

  it("an edit changes only what it must: more people means more packs, same products", () => {
    const before = solve(session(pastaNeeds()), ctx);
    const after = solve(session(pastaNeeds(), { people: 8 }, { picks: picksOf(before) }), ctx);
    const d = diffCarts(before, after);
    expect(d.swapped).toHaveLength(0);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.packs.length).toBeGreaterThan(0);
    expect(describeDiff(d)).toMatch(/→/);
    expect(collateral(d, before, after, new Set(["pasta", "tomato", "cream", "cheese"]))).toBe(0);
  });
});

describe("solve: budgets", () => {
  it("fits the budget by picking cheaper options, not by dropping core needs", () => {
    const free = solve(session(pastaNeeds(), { quality: "premium" }), ctx);
    const budget = free.total - 60;
    const cart = solve(session(pastaNeeds(), { quality: "premium", budget_inr: budget }), ctx);
    expect(cart.total).toBeLessThanOrEqual(budget);
    for (const id of ["pasta", "tomato", "cream", "cheese", "garlic"]) expect(line(cart, id)).toBeTruthy();
  });

  it("drops extras before going over, and says so", () => {
    const cart = solve(session(pastaNeeds(), { quality: "value" }), ctx);
    const withoutBasil = cart.total - line(cart, "basil")!.line_total;
    const tight = solve(session(pastaNeeds(), { quality: "value", budget_inr: withoutBasil + 5 }), ctx);
    expect(tight.total).toBeLessThanOrEqual(withoutBasil + 5);
    expect(tight.dropped.map((d) => d.need_id)).toEqual(["basil"]);
    expect(endNote(session(pastaNeeds(), { budget_inr: withoutBasil + 5 }), tight).join(" ")).toMatch(/Left out basil/);
  });

  it("never drops main or core needs: an impossible budget keeps them at their cheapest and reports the floor", () => {
    const s = session(pastaNeeds(), { budget_inr: 50 });
    const cart = solve(s, ctx);
    expect(cart.total).toBe(cart.floor_inr);
    expect(cart.total).toBeGreaterThan(50);
    const checks = review(s, cart, ctx.index);
    expect(checks.find((c) => c.id === "budget")?.status).toBe("fail");
    expect(endNote(s, cart).join(" ")).toMatch(/the lowest is ₹\d+/);
  });
});

describe("knapsack", () => {
  // Brute force over every combination, for small random instances.
  const brute = (plans: { options: { cost: number; util: number }[]; mandatory: boolean }[], budget: number) => {
    let best = -Infinity;
    const go = (i: number, cost: number, util: number) => {
      if (cost > budget) return;
      if (i === plans.length) return void (best = Math.max(best, util));
      if (!plans[i].mandatory) go(i + 1, cost, util - 20);
      for (const o of plans[i].options) go(i + 1, cost + o.cost, util + o.util);
    };
    go(0, 0, 0);
    return best;
  };

  it("finds the best total utility within the budget (matches brute force)", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 300; t++) {
      const plans = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => ({
        mandatory: rand() < 0.6,
        options: Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({ cost: 10 + Math.floor(rand() * 200), util: Math.round(rand() * 100) / 100 })),
      }));
      const budget = 50 + Math.floor(rand() * 600);
      const picks = knapsack(plans, budget);
      const expected = brute(plans, budget);
      if (expected === -Infinity) {
        expect(picks).toBeNull();
        continue;
      }
      expect(picks).not.toBeNull();
      const cost = picks!.reduce((s, k, i) => s + (k >= 0 ? plans[i].options[k].cost : 0), 0);
      const util = picks!.reduce((s, k, i) => s + (k >= 0 ? plans[i].options[k].util : -20), 0);
      expect(cost).toBeLessThanOrEqual(budget);
      expect(util).toBeCloseTo(expected, 6);
    }
  });
});

describe("review", () => {
  it("passes a solved cart", () => {
    const s = session(pastaNeeds(), { diet: "veg", rules: [{ kind: "exclude_word", value: "onion", label: "No onions" }] });
    const checks = review(s, solve(s, ctx), ctx.index);
    expect(passes(checks)).toBe(true);
    expect(checks.map((c) => c.label)).toEqual(expect.arrayContaining(["All in stock", "Amounts for 4 people", "Vegetarian", "No onions", "No duplicates"]));
  });

  it("catches a tampered cart without trusting the solver", () => {
    const s = session(pastaNeeds(), { rules: [{ kind: "exclude_word", value: "onion", label: "No onions" }] });
    const cart = solve(s, ctx);
    const onion = byName("Onion");
    const bad = {
      ...cart,
      lines: [
        ...cart.lines.map((l, i) => (i === 0 ? { ...l, line_total: l.line_total + 1 } : l)),
        { ...cart.lines[1], need_id: "x", product: { ...cart.lines[1].product, id: onion.id, name: onion.name, sub_category: "onion" } },
      ],
    };
    const failed = review(s, bad, ctx.index).filter((c) => c.status === "fail").map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["prices", "rule:No onions"]));
  });
});

describe("solve: picking the ordinary product", () => {
  const breads: Product[] = [
    { id: "p950", name: "Sandwich Bread", brand: "Harvest", category: "bakery", sub_category: "loaf", pack_size: 400, unit: "g", price: 50, in_stock: true, tags: ["veg"] },
    { id: "p951", name: "Brown Bread", brand: "Harvest", category: "bakery", sub_category: "loaf", pack_size: 400, unit: "g", price: 55, in_stock: true, tags: ["veg"] },
    { id: "p952", name: "Whole Wheat Bread", brand: "Bonn", category: "bakery", sub_category: "loaf", pack_size: 400, unit: "g", price: 55, in_stock: true, tags: ["veg"] },
    { id: "p953", name: "Ladi Pav", brand: "Fresho", category: "bakery", sub_category: "loaf", pack_size: 6, unit: "pcs", price: 35, in_stock: true, tags: ["veg"] },
    { id: "p954", name: "Instant Dry Yeast Powder", brand: "Bakers", category: "bakery", sub_category: "loaf", pack_size: 100, unit: "g", price: 300, in_stock: true, tags: ["veg"] },
  ];
  const c = { products: breads, index: indexCatalog(breads) };

  it("prefers a product that looks like the rest of its kind over an oddity filed with them", () => {
    for (const quality of ["value", "balanced", "premium"] as const) {
      const cart = solve(session([need("bread", "loaf", 1, "pack", { per_person: false, label: "Bread" })], { quality }), c);
      expect(cart.lines[0].product.name).toMatch(/Bread$/);
    }
  });

  it("uses the need's label as a soft preference", () => {
    const cart = solve(session([need("bread", "loaf", 1, "pack", { per_person: false, label: "Brown bread" })]), c);
    expect(cart.lines[0].product.name).toBe("Brown Bread");
  });

  it("a preference nothing in stock matches stays a nudge, not a missing item", () => {
    const cart = solve(session([need("bread", "loaf", 1, "pack", { per_person: false, label: "Bread", prefer: "multigrain" })]), c);
    expect(cart.unmet).toEqual([]);
    expect(cart.lines[0].product.name).toMatch(/Bread$/);
  });

  it("never stands in a different thing for a sold-out product: fresh cream doesn't become a cream biscuit", () => {
    const amul = byName("Fresh Cream", "Amul");
    const md = byName("Fresh Cream", "Mother Dairy");
    const gone = products.map((p) => (p.id === amul.id || p.id === md.id ? { ...p, in_stock: false } : p));
    const cart = solve(session([need("cream", "cream", 30, "ml", { prefer: "fresh cream", label: "Fresh cream" })]), { products: gone, index: indexCatalog(gone) });
    expect(cart.lines).toHaveLength(0);
    expect(cart.unmet[0]).toMatchObject({ need_id: "cream", reason: "out_of_stock" });
    expect(cart.unmet[0].detail).toMatch(/Fresh Cream is out of stock, and nothing close enough is in stock/);
  });
});
