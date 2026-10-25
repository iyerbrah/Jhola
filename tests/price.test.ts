import { describe, expect, it } from "vitest";
import { cartTotal, priceVariants } from "@/lib/price";
import { classic, index, item } from "./fixtures";

describe("priceVariants", () => {
  it("fills product fields from the catalog and totals non-optional items", () => {
    const [cart] = priceVariants([classic], index);
    expect(cart.total).toBe(2 * 95 + 40 + 30 + 67);
    expect(cart.items[0]).toEqual({
      product_id: "p001",
      name: "Fresh Paneer",
      brand: "Amul",
      pack_label: "200 g",
      price: 95,
      qty: 2,
      line_total: 190,
      optional: false,
      note: "",
      sub_category: "paneer",
    });
    const salt = cart.items.find((i) => i.product_id === "p005")!;
    expect(salt.optional).toBe(true);
    expect(salt.line_total).toBe(28);
    expect(salt.pack_label).toBe("1 kg");
  });

  it("ignores any product that isn't in the catalog", () => {
    const [cart] = priceVariants([{ name: "X", reason: "", model_total_inr: 0, items: [item("p999", 3), item("p002")] }], index);
    expect(cart.items.map((i) => i.product_id)).toEqual(["p002"]);
    expect(cart.total).toBe(40);
  });
});

describe("cartTotal", () => {
  it("skips optional and unknown items", () => {
    expect(cartTotal([item("p001", 3), item("p005", 1, true), item("p999", 2)], index)).toBe(285);
  });
});
