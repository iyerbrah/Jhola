import { describe, expect, it } from "vitest";
import { fitToBudget } from "@/lib/budget";
import { cartTotal } from "@/lib/price";
import { classic, index, item, products } from "./fixtures";

describe("fitToBudget", () => {
  it("returns the cart unchanged when already within budget", () => {
    const res = fitToBudget(classic, 400, index, products)!;
    expect(res.items).toEqual(classic.items);
  });

  it("makes the smallest swap that gets under budget", () => {
    // ₹327 -> swapping Amul paneer (₹95) for Malai (₹72) saves 2×23 = ₹46 -> ₹281
    const res = fitToBudget(classic, 300, index, products)!;
    expect(res.items[0].product_id).toBe("p010");
    expect(cartTotal(res.items, index)).toBe(281);
  });

  it("never swaps to an out-of-stock item, a much smaller pack, or touches optional items", () => {
    const res = fitToBudget(classic, 300, index, products)!;
    const ids = res.items.map((i) => i.product_id);
    expect(ids).not.toContain("p009"); // out of stock
    expect(ids).not.toContain("p011"); // 50 g instead of 200 g
    expect(res.items.find((i) => i.product_id === "p005")!.optional).toBe(true);
  });

  it("lowers quantities when swaps aren't enough", () => {
    const v = { ...classic, items: [item("p010", 4), item("p002")] }; // 288 + 40 = 328
    const res = fitToBudget(v, 260, index, products)!;
    expect(cartTotal(res.items, index)).toBeLessThanOrEqual(260);
    expect(res.items[0].qty).toBe(3);
  });

  it("gives up when nothing can fit", () => {
    expect(fitToBudget({ ...classic, items: [item("p004")] }, 10, index, products)).toBeNull();
  });
});
