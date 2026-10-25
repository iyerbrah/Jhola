import { indexCatalog } from "@/lib/catalog";
import type { LlmOutput, LlmVariant, Product } from "@/lib/schema";

const base: Pick<Product, "category" | "unit" | "in_stock" | "tags"> = { category: "dairy", unit: "g", in_stock: true, tags: [] };

export const products: Product[] = [
  { ...base, id: "p001", name: "Fresh Paneer", brand: "Amul", sub_category: "paneer", pack_size: 200, price: 95, tags: ["veg", "high_protein"] },
  { ...base, id: "p002", name: "Tomato", brand: "Fresho", category: "fruits_vegetables", sub_category: "tomato", pack_size: 1000, price: 40 },
  { ...base, id: "p003", name: "Onion", brand: "Fresho", category: "fruits_vegetables", sub_category: "onion", pack_size: 1000, price: 30 },
  { ...base, id: "p004", name: "Fresh Cream", brand: "Amul", sub_category: "cream", pack_size: 250, unit: "ml", price: 67 },
  { ...base, id: "p005", name: "Salt", brand: "Tata", category: "masalas_spices", sub_category: "salt", pack_size: 1000, price: 28 },
  { ...base, id: "p006", name: "Butter", brand: "Amul", sub_category: "butter", pack_size: 100, price: 56 },
  { ...base, id: "p007", name: "Paneer Masala", brand: "MDH", category: "masalas_spices", sub_category: "masala_mix", pack_size: 100, price: 85 },
  { ...base, id: "p008", name: "Ready Gravy", brand: "MTR", category: "snacks", sub_category: "ready_meal", pack_size: 300, price: 125 },
  { ...base, id: "p009", name: "Old Paneer", brand: "Nobody", sub_category: "paneer", pack_size: 200, price: 80, in_stock: false },
  { ...base, id: "p010", name: "Malai Paneer", brand: "Fresho", sub_category: "paneer", pack_size: 200, price: 72 },
  { ...base, id: "p011", name: "Paneer Tiny", brand: "Fresho", sub_category: "paneer", pack_size: 50, price: 20 },
  // dark chocolates for count/budget tests
  { ...base, id: "p101", name: "Dark 70% Cocoa", brand: "Lindt", category: "chocolates", sub_category: "dark_chocolate", pack_size: 100, price: 375, tags: ["dark_chocolate", "cocoa_70"] },
  { ...base, id: "p102", name: "Dark 85% Cocoa", brand: "Lindt", category: "chocolates", sub_category: "dark_chocolate", pack_size: 100, price: 375, tags: ["dark_chocolate", "cocoa_85"] },
  { ...base, id: "p103", name: "Bournville 50% Cocoa", brand: "Cadbury", category: "chocolates", sub_category: "dark_chocolate", pack_size: 80, price: 100, tags: ["dark_chocolate"] },
  { ...base, id: "p104", name: "Bitter 75% Cocoa", brand: "Amul", category: "chocolates", sub_category: "dark_chocolate", pack_size: 150, price: 200, tags: ["dark_chocolate"] },
  { ...base, id: "p105", name: "Single Origin Dark", brand: "Amul", category: "chocolates", sub_category: "dark_chocolate", pack_size: 125, price: 80, tags: ["dark_chocolate"] },
  { ...base, id: "p106", name: "Milk Chocolate", brand: "Cadbury", category: "chocolates", sub_category: "chocolate", pack_size: 50, price: 50 },
];

export const index = indexCatalog(products);

const item = (product_id: string, qty = 1, optional = false, need = 0) => ({ product_id, need, qty, optional, note: "" });

export const classic: LlmVariant = {
  name: "Classic",
  reason: "From scratch",
  items: [item("p001", 2), item("p002"), item("p003"), item("p004"), item("p005", 1, true)],
  model_total_inr: 327,
};
export const budget: LlmVariant = {
  name: "Budget",
  reason: "Butter instead of cream",
  items: [item("p001", 2), item("p002"), item("p006"), item("p007")],
  model_total_inr: 371,
};
export const shortcut: LlmVariant = {
  name: "Shortcut",
  reason: "Ready gravy",
  items: [item("p001", 2), item("p008")],
  model_total_inr: 315,
};

export function output(overrides: Partial<LlmOutput> = {}): LlmOutput {
  return {
    status: "ok",
    message: "",
    assumptions: ["Assumed 4 people"],
    suggestions: [],
    constraints: { budget_inr: null, item_count: null, item_kind: null },
    variants: [classic, budget, shortcut],
    ...overrides,
  };
}

export { item };
