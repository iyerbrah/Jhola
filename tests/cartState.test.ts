import { describe, expect, it } from "vitest";
import { cartTotal, orderedItems, removeItem, setQty, swapItem, swapOptions, toEditable, toggleOptional } from "@/lib/cartState";
import { priceVariants } from "@/lib/price";
import { classic, index, products } from "./fixtures";

// Classic: 2× paneer p001 (₹95), tomato p002 (₹40), onion p003 (₹30), cream p004 (₹67), salt p005 (₹28, optional)
const fresh = () => toEditable(priceVariants([classic], index)[0]);

describe("cart editing", () => {
  it("starts with optional items unticked and totals required items", () => {
    const cart = fresh();
    expect(cart.items.find((i) => i.product_id === "p005")!.included).toBe(false);
    expect(cartTotal(cart)).toBe(327);
  });

  it("adds a ticked optional item to the total", () => {
    const cart = toggleOptional(fresh(), "p005");
    expect(cartTotal(cart)).toBe(355);
    expect(orderedItems(cart).map((i) => i.product_id)).toContain("p005");
    expect(cartTotal(toggleOptional(cart, "p005"))).toBe(327);
  });

  it("never unticks a required item", () => {
    expect(cartTotal(toggleOptional(fresh(), "p001"))).toBe(327);
  });

  it("changes quantity within 1-10 and updates the line total", () => {
    let cart = setQty(fresh(), "p001", 3);
    expect(cart.items[0].line_total).toBe(285);
    expect(cartTotal(cart)).toBe(422);
    cart = setQty(cart, "p001", 0);
    expect(cart.items[0].qty).toBe(1);
    cart = setQty(cart, "p001", 99);
    expect(cart.items[0].qty).toBe(10);
  });

  it("removes an item", () => {
    const cart = removeItem(fresh(), "p004");
    expect(cart.items.map((i) => i.product_id)).not.toContain("p004");
    expect(cartTotal(cart)).toBe(260);
  });

  it("offers in-stock swaps of the same kind, cheapest first, excluding what's in the cart", () => {
    const cart = fresh();
    const paneer = cart.items[0];
    expect(swapOptions(cart, paneer, products).map((p) => p.id)).toEqual(["p011", "p010"]); // p009 is out of stock
  });

  it("swaps a product, keeping the quantity", () => {
    const cart = swapItem(fresh(), "p001", products.find((p) => p.id === "p010")!);
    expect(cart.items[0]).toMatchObject({ product_id: "p010", name: "Malai Paneer", brand: "Fresho", qty: 2, price: 72, line_total: 144 });
    expect(cartTotal(cart)).toBe(281);
  });
});
