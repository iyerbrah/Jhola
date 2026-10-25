import { describe, expect, it } from "vitest";
import { percentile, scoreCase, summarise, type EvalCase } from "@/evals/score";
import { priceVariants } from "@/lib/price";
import type { BuildCartsResponse, LlmVariant } from "@/lib/schema";
import { budget, classic, index, item, shortcut } from "./fixtures";

const response = (variants: LlmVariant[], overrides: Partial<BuildCartsResponse> = {}): BuildCartsResponse => ({
  status: "ok",
  message: "",
  assumptions: [],
  suggestions: [],
  variants: priceVariants(variants, index),
  meta: { latency_ms: 4000, model: "fake", repaired: false, input_tokens: 0, cached_tokens: 0, output_tokens: 0 },
  ...overrides,
});

const paneer: EvalCase = { group: "recipe", query: "paneer for 4", expected_status: "ok", must_include_any: [["paneer"], ["cream", "butter"]] };

describe("scoreCase", () => {
  it("passes a good answer and counts ingredient groups per cart", () => {
    const s = scoreCase(paneer, response([classic, budget, shortcut]), index, 0.02);
    expect(s.valid).toBe(true);
    expect(s.status_ok).toBe(true);
    // Shortcut has paneer but no cream/butter: 5 of 6 groups.
    expect([s.groups_hit, s.groups_total]).toEqual([5, 6]);
    expect(s.problems).toContain("Shortcut has none of: cream, butter");
    expect(s.constraints_ok).toBeNull();
  });

  it("fails an answer with fewer than 3 carts or the wrong status", () => {
    expect(scoreCase(paneer, response([classic, budget]), index, null).valid).toBe(false);
    const laptop: EvalCase = { group: "edge", query: "a laptop", expected_status: "cannot_fulfil" };
    expect(scoreCase(laptop, response([classic, budget, shortcut]), index, null).status_ok).toBe(false);
    const ok = scoreCase(laptop, response([], { status: "cannot_fulfil" }), index, null);
    expect(ok.status_ok && ok.valid).toBe(true);
  });

  it("checks the eval's own budget against cart totals", () => {
    // Totals: Classic 327, Budget 371, Shortcut 315
    const s = scoreCase({ ...paneer, budget_inr: 350 }, response([classic, budget, shortcut]), index, null);
    expect(s.constraints_ok).toBe(false);
    expect(s.valid).toBe(false);
    expect(s.problems).toContain("Budget is ₹371, over the ₹350 budget");
  });

  it("checks an exact count of a kind of item", () => {
    const four = (name: string, ids: string[]): LlmVariant => ({ name, reason: "", model_total_inr: 0, items: ids.map((id) => item(id)) });
    const choc: EvalCase = { group: "budget_gift", query: "4 dark chocolates", expected_status: "ok", item_count: 4, item_kind: "dark_chocolate" };
    const good = scoreCase(choc, response([four("A", ["p101", "p102", "p103", "p104"]), four("B", ["p105", "p101", "p103", "p104"]), four("C", ["p102", "p105", "p104", "p103"])]), index, null);
    expect(good.constraints_ok).toBe(true);
    const bad = scoreCase(choc, response([four("A", ["p101", "p102", "p103", "p106"]), four("B", ["p105", "p101", "p103", "p104"]), four("C", ["p102", "p105", "p104", "p103"])]), index, null);
    expect(bad.constraints_ok).toBe(false);
    expect(bad.problems).toContain("A has 3 dark_chocolate (+1 other), needs exactly 4");
  });

  it("flags out-of-stock items and wrong totals as invalid", () => {
    const res = response([classic, budget, shortcut]);
    res.variants[0].items.push({ ...res.variants[0].items[0], product_id: "p009", name: "Old Paneer", price: 80, line_total: 80 });
    res.variants[1].total += 5;
    const s = scoreCase(paneer, res, index, null);
    expect(s.valid).toBe(false);
    expect(s.problems.some((p) => p.includes("Old Paneer is out of stock"))).toBe(true);
    expect(s.problems.some((p) => p.includes("total ₹376 but items add up to ₹371"))).toBe(true);
  });
});

describe("summarise", () => {
  it("computes shares, Jaccard, percentiles and counts crashed runs as invalid", () => {
    const a = scoreCase(paneer, response([classic, budget, shortcut]), index, 0.02);
    const b = scoreCase(paneer, response([classic, budget, shortcut], { meta: { latency_ms: 9000, model: "fake", repaired: true, input_tokens: 0, cached_tokens: 0, output_tokens: 0 } }), index, 0.04);
    const s = summarise([a, b], 1);
    expect(s.cases).toBe(3);
    expect(s.valid_first_try).toBeCloseTo(1 / 3);
    expect(s.valid_after_repair).toBeCloseTo(2 / 3);
    expect(s.avg_cost_usd).toBeCloseTo(0.03);
    expect(s.latency_p95_s).toBe(9);
  });

  it("percentile uses nearest rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});
