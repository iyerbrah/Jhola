import { describe, expect, it } from "vitest";
import { tidyCart } from "@/lib/tidy";
import type { LlmVariant } from "@/lib/schema";
import { index, item, products } from "./fixtures";

const cart = (items: LlmVariant["items"]): LlmVariant => ({ name: "X", reason: "", model_total_inr: 0, items });

describe("tidyCart", () => {
  it("merges a product listed twice, adding quantities up to 10", () => {
    const out = tidyCart(cart([item("p002", 3), item("p003"), item("p002", 9)]), index, products);
    expect(out.items.map((i) => [i.product_id, i.qty])).toEqual([["p002", 10], ["p003", 1]]);
  });

  it("keeps a merged line required if either copy was required", () => {
    const out = tidyCart(cart([item("p005", 1, true), item("p005", 1, false)]), index, products);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].optional).toBe(false);
  });

  it("swaps an out-of-stock product for the in-stock one of the same kind closest in price", () => {
    // p009 (₹80, out of stock) -> p010 Malai paneer ₹72 is closest
    const out = tidyCart(cart([item("p009", 2)]), index, products);
    expect(out.items[0]).toMatchObject({ product_id: "p010", qty: 2 });
  });

  it("clamps silly quantities and leaves unknown IDs for the repair call", () => {
    const out = tidyCart(cart([item("p002", 0), item("p003", 14.6), item("p999")]), index, products);
    expect(out.items.map((i) => [i.product_id, i.qty])).toEqual([["p002", 1], ["p003", 10], ["p999", 1]]);
  });
});

describe("pack counts from need", () => {
  it("computes whole packs from the amount needed, overriding the model's qty", () => {
    // Paneer p001 is a 200 g pack: 400 g -> 2, 500 g -> 3. Within 5% of a pack we don't buy another:
    // 410 g -> 2 (only 10 g short), 420 g -> 3, 205 g -> 1.
    const packs = (need: number, qty = 7) => tidyCart(cart([item("p001", qty, false, need)]), index, products).items[0].qty;
    expect(packs(400)).toBe(2);
    expect(packs(500)).toBe(3);
    expect(packs(410)).toBe(2);
    expect(packs(420)).toBe(3);
    expect(packs(205)).toBe(1);
    expect(packs(0, 4)).toBe(4); // need 0 -> use the model's qty
    expect(packs(2000)).toBe(10); // 10 packs is fine
    expect(packs(5000, 2)).toBe(2); // 25 packs means a unit mix-up: keep the model's qty
  });

  it("re-counts packs when an out-of-stock item is swapped", () => {
    // Out-of-stock p009 (200 g) -> Malai p010 (200 g): 600 g -> 3 packs
    const out = tidyCart(cart([item("p009", 1, false, 600)]), index, products);
    expect(out.items[0]).toMatchObject({ product_id: "p010", qty: 3 });
  });
});

describe("best pack size", () => {
  it("picks the cheapest size of the same product that covers the need", () => {
    const pick = (id: string, need: number) => tidyCart(cart([item(id, 1, false, need)]), index, products).items[0];
    // 400 g: one 1 kg bag (₹84), not the 5 kg bag (₹429) the model chose
    expect(pick("p021", 400)).toMatchObject({ product_id: "p020", qty: 1 });
    // 4.5 kg: five 1 kg bags (₹420) cost less than one 5 kg bag (₹429)
    expect(pick("p021", 4500)).toMatchObject({ product_id: "p020", qty: 5 });
    // 9 kg: nine 1 kg bags (₹756) cost less than two 5 kg bags (₹858)
    expect(pick("p020", 9000)).toMatchObject({ product_id: "p020", qty: 9 });
  });

  it("leaves items without a need alone", () => {
    expect(tidyCart(cart([item("p021", 1)]), index, products).items[0].product_id).toBe("p021");
  });
});
