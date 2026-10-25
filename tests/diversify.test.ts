import { describe, expect, it } from "vitest";
import { diversify } from "@/lib/diversify";
import { cartTotal } from "@/lib/price";
import type { LlmVariant } from "@/lib/schema";
import { jaccard } from "@/lib/validate";
import { budget, classic, index, item, products } from "./fixtures";

const cart = (name: string, ids: string[]): LlmVariant => ({ name, reason: "", model_total_inr: 0, items: ids.map((id) => item(id)) });

describe("diversify", () => {
  it("leaves carts that are already different alone", () => {
    const out = diversify([classic, budget], index, products, null);
    expect(out[1].items).toEqual(budget.items);
  });

  it("swaps shared items in the later cart for another product of the same kind", () => {
    // The same three dark chocolates in both carts; p104 and p105 are unused alternatives.
    const a = cart("A", ["p101", "p102", "p103"]);
    const b = cart("B", ["p101", "p102", "p103"]);
    const [, b2] = diversify([a, b], index, products, null);
    expect(jaccard(a, b2)).toBeLessThan(0.6);
    // Still three dark chocolates, no repeats, first cart untouched.
    expect(b2.items.every((it) => index.get(it.product_id)!.sub_category === "dark_chocolate")).toBe(true);
    expect(new Set(b2.items.map((it) => it.product_id)).size).toBe(3);
    expect(a.items.map((it) => it.product_id)).toEqual(["p101", "p102", "p103"]);
  });

  it("never pushes a cart over the budget to make it different", () => {
    const a = cart("A", ["p010", "p002"]); // Malai paneer ₹72 + tomato ₹40
    const b = cart("B", ["p010", "p002"]);
    const [, b2] = diversify([a, b], index, products, 112);
    // The only other paneer in stock (Amul, ₹95) would make it ₹135, over ₹112.
    expect(b2.items.map((it) => it.product_id)).toEqual(["p010", "p002"]);
    expect(cartTotal(b2.items, index)).toBeLessThanOrEqual(112);
  });
});
