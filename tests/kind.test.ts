import { describe, expect, it } from "vitest";
import { indexCatalog } from "@/lib/catalog";
import { solve } from "@/lib/cart/solve";
import { isSameKind, matchesKind } from "@/lib/cart/kind";
import type { Product } from "@/lib/schema";

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
  it("when the solver substitutes a sold-out rice", () => {
    const soldOut = products.map((p) => (p.id === "p201" ? { ...p, in_stock: false } : p));
    const session = {
      brief: { summary: "", people: 2, budget_inr: null, diet: null, quality: "balanced" as const, rules: [], assumptions: [], plan: [] },
      needs: [{ id: "rice", group: "dish", label: "Rice", kind: "rice", amount: 100, unit: "g" as const, per_person: true, role: "core" as const, ticked: true, count: null, prefer: null, why: "", confidence: "sure" as const }],
      pins: [{ need_id: "rice", product_id: "p201", qty: null }],
      picks: {},
      choices: {},
    };
    const cart = solve(session, { products: soldOut, index: indexCatalog(soldOut) });
    expect(cart.lines[0].product.id).toBe("p202");
    expect(cart.lines[0].substitution?.wanted.id).toBe("p201");
  });
});

describe("matchesKind", () => {
  it("matches by kind, tag or name", () => {
    expect(matchesKind(byId("p201"), "rice")).toBe(true);
    expect(matchesKind(byId("p206"), "cumin")).toBe(true);
    expect(matchesKind(byId("p205"), "rice")).toBe(false);
  });
});
