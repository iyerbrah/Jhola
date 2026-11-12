/**
 * Property tests: thousands of random sessions over the real catalog. Whatever the agent writes,
 * the solver must return a cart that keeps every rule.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { catalog, catalogIndex } from "@/lib/catalog";
import { blockedBy, picksOf, solve } from "@/lib/cart/solve";
import { review } from "@/lib/cart/review";
import { cartTotal, QUALITIES, type Need, type Session } from "@/lib/cart/types";
import { DIETS } from "@/lib/requirements";

const ctx = { products: catalog, index: catalogIndex };
const kinds = [...new Set(catalog.map((p) => p.sub_category))].sort();
const words = ["onion", "garlic", "sugar", "milk", "chicken", "amul", "fresho", "masala", "rice"];

const needArb: fc.Arbitrary<Need> = fc.record({
  id: fc.constant("x"),
  group: fc.constantFrom("dish", "cleaning", "snacks"),
  label: fc.constantFrom("Item", "Thing"),
  kind: fc.constantFrom(...kinds, "not_a_kind"),
  amount: fc.integer({ min: 1, max: 3000 }),
  unit: fc.constantFrom("g", "ml", "pcs", "pack"),
  per_person: fc.boolean(),
  role: fc.constantFrom("main", "core", "extra", "pantry"),
  ticked: fc.boolean(),
  count: fc.option(fc.integer({ min: 2, max: 5 }), { nil: null }),
  prefer: fc.option(fc.constantFrom("organic", "fresh", "dark", "whole wheat", "premium"), { nil: null }),
  why: fc.constant(""),
  confidence: fc.constantFrom("sure", "guess"),
}) as fc.Arbitrary<Need>;

const sessionArb: fc.Arbitrary<Session> = fc
  .record({
    needs: fc.array(needArb, { minLength: 1, maxLength: 14 }),
    people: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
    budget: fc.option(fc.integer({ min: 50, max: 5000 }), { nil: null }),
    diet: fc.option(fc.constantFrom(...DIETS), { nil: null }),
    quality: fc.constantFrom(...QUALITIES),
    rules: fc.array(
      fc.record({ kind: fc.constantFrom("exclude_word", "exclude_brand", "exclude_kind", "have"), value: fc.constantFrom(...words) }).map((r) => ({ ...r, label: `${r.kind} ${r.value}` })),
      { maxLength: 3 },
    ),
  })
  .map(({ needs, people, budget, diet, quality, rules }) => ({
    brief: { summary: "", people, budget_inr: budget, diet, quality, rules: rules as Session["brief"]["rules"], assumptions: [], plan: [] },
    needs: needs.map((n, i) => ({ ...n, id: `n${i}` })),
    pins: [],
    picks: {},
    choices: {},
  }));

describe("solver invariants (random sessions, real catalog)", () => {
  it("every cart keeps every rule", () => {
    fc.assert(
      fc.property(sessionArb, (s) => {
        const cart = solve(s, ctx);
        const ids = cart.lines.map((l) => l.product.id);
        expect(new Set(ids).size).toBe(ids.length); // one line per product
        for (const l of cart.lines) {
          const p = catalogIndex.get(l.product.id)!;
          expect(p.in_stock).toBe(true);
          expect(blockedBy(p, s.brief)).toBeNull(); // diet and every rule
          expect(Number.isInteger(l.packs) && l.packs >= 1 && l.packs <= 10).toBe(true);
          expect(l.line_total).toBe(p.price * l.packs);
          expect(l.product.price).toBe(p.price);
        }
        expect(cart.total).toBe(cartTotal(cart.lines));
        // Within budget whenever keeping every main and core need makes that possible.
        if (s.brief.budget_inr != null && cart.floor_inr <= s.brief.budget_inr) expect(cart.total).toBeLessThanOrEqual(s.brief.budget_inr);
        // Main and core needs are never dropped for a budget.
        for (const d of cart.dropped) expect(s.needs.find((n) => n.id === d.need_id)!.role).toBe("extra");
        // Every need is accounted for: a line, or unmet, dropped or skipped.
        for (const n of s.needs) {
          const seen = cart.lines.some((l) => l.need_id === n.id || l.also_for.includes(n.id)) || [...cart.unmet, ...cart.dropped, ...cart.skipped].some((x) => x.need_id === n.id);
          expect(seen).toBe(true);
        }
        // The independent review agrees (budget can fail honestly when the floor is over it).
        const failed = review(s, cart, catalogIndex).filter((c) => c.status === "fail" && c.id !== "budget");
        expect(failed).toEqual([]);
      }),
      { numRuns: 1500 },
    );
  });

  it("is deterministic, and solving again with its own picks changes nothing", () => {
    fc.assert(
      fc.property(sessionArb, (s) => {
        const a = solve(s, ctx);
        expect(solve(s, ctx)).toEqual(a);
        const b = solve({ ...s, picks: picksOf(a) }, ctx);
        const shape = (c: typeof a) => c.lines.map((l) => [l.need_id, l.product.id, l.packs]);
        expect(shape(b)).toEqual(shape(a));
      }),
      { numRuns: 500 },
    );
  });

  it("pins are kept whenever they fit the rules and are in stock", () => {
    fc.assert(
      fc.property(sessionArb, fc.nat(), (s, seed) => {
        const first = solve(s, ctx);
        const l = first.lines[seed % Math.max(1, first.lines.length)];
        if (!l || !l.counted) return;
        const pinned = { ...s, pins: [{ need_id: l.need_id, product_id: l.product.id, qty: null }] };
        const cart = solve(pinned, ctx);
        expect(cart.lines.some((x) => x.need_id === l.need_id && x.product.id === l.product.id && x.pinned)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
