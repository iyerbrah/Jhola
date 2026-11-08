import { describe, expect, it } from "vitest";
import { fitToBudget } from "@/lib/budget";
import { indexCatalog } from "@/lib/catalog";
import { swapOptions, toEditable } from "@/lib/cartState";
import { isSameKind } from "@/lib/kind";
import { priceVariants } from "@/lib/price";
import type { LlmVariant, Product } from "@/lib/schema";

// The real catalog files rice flour and rice cakes under "rice", and cumin powder next to whole cumin.
const base: Pick<Product, "category" | "unit" | "in_stock" | "tags"> = { category: "atta_rice_dal", unit: "g", in_stock: true, tags: [] };
const products: Product[] = [
  { ...base, id: "p201", name: "Rice - Ponni", brand: "BB Popular", sub_category: "rice", pack_size: 1000, price: 51 },
  { ...base, id: "p202", name: "New Rice - Sona Masoori", brand: "BB Popular", sub_category: "rice", pack_size: 1000, price: 48 },
  { ...base, id: "p203", name: "Rice - Flour", brand: "BB Royal", sub_category: "rice", pack_size: 1000, price: 41 },
  { ...base, id: "p204", name: "Rice Cakes - Classic Plain", brand: "Suprfit", sub_category: "rice", pack_size: 120, price: 139 },
  { ...base, id: "p205", name: "Cumin - Whole", brand: "BB Royal", category: "masalas_spices", sub_category: "cumin", pack_size: 100, price: 40 },
  { ...base, id: "p206", name: "Cumin Powder", brand: "Catch", category: "masalas_spices", sub_category: "cumin", pack_size: 100, price: 35 },
  { ...base, id: "p207", name: "Jeera Whole", brand: "Tata", category: "masalas_spices", sub_category: "cumin", pack_size: 100, price: 45 },
];
const index = indexCatalog(products);
const byId = (id: string) => index.get(id)!;

describe("isSameKind", () => {
  it("treats different rices as the same kind", () => {
    expect(isSameKind(byId("p201"), byId("p202"))).toBe(true);
  });

  it("never turns rice into rice flour or rice cakes", () => {
    expect(isSameKind(byId("p201"), byId("p203"))).toBe(false);
    expect(isSameKind(byId("p201"), byId("p204"))).toBe(false);
  });

  it("keeps whole spices and powders apart", () => {
    expect(isSameKind(byId("p205"), byId("p206"))).toBe(false);
    expect(isSameKind(byId("p205"), byId("p207"))).toBe(true);
  });
});

describe("rice never becomes rice flour", () => {
  const ponni: LlmVariant = {
    name: "Budget",
    reason: "",
    model_total_inr: 51,
    items: [{ product_id: "p201", need: 0, qty: 1, optional: false, note: "" }],
  };

  it("in the Swap list", () => {
    const cart = toEditable(priceVariants([ponni], index)[0]);
    expect(swapOptions(cart, cart.items[0], products).map((p) => p.id)).toEqual(["p202"]);
  });

  it("when fitting a cart to a budget", () => {
    // Only rice flour (₹41) would get this under ₹45; plain rice can't, so the cart is left for the repair call.
    expect(fitToBudget(ponni, 45, index, products)).toBeNull();
  });
});
