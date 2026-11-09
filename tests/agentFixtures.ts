import { CartsInputSchema, repriceCarts, type AgentCart } from "@/lib/agent/carts";
import { createMemorySearch } from "@/lib/agent/search";
import { indexCatalog } from "@/lib/catalog";
import type { Requirements } from "@/lib/requirements";
import type { Product } from "@/lib/schema";

const base: Pick<Product, "unit" | "in_stock" | "brand"> = { unit: "g", in_stock: true, brand: "Fresho" };

export const products: Product[] = [
  { ...base, id: "p001", name: "Fresh Paneer", category: "dairy", sub_category: "paneer", pack_size: 200, price: 95, tags: ["veg", "jain", "high_protein"] },
  { ...base, id: "p002", name: "Chicken Curry Cut", category: "eggs_meat", sub_category: "chicken", pack_size: 500, price: 210, tags: ["high_protein"] },
  { ...base, id: "p003", name: "Onion", category: "fruits_vegetables", sub_category: "onion", pack_size: 1000, price: 30, tags: ["veg", "vegan"] },
  { ...base, id: "p004", name: "Basmati Rice", category: "atta_rice_dal", sub_category: "basmati_rice", pack_size: 1000, price: 84, tags: ["veg", "vegan", "jain"] },
  { ...base, id: "p005", name: "Salt", category: "masalas_spices", sub_category: "salt", pack_size: 1000, price: 28, tags: ["veg", "vegan", "jain"] },
  { ...base, id: "p006", name: "Old Paneer", brand: "Nobody", category: "dairy", sub_category: "paneer", pack_size: 200, price: 80, in_stock: false, tags: ["veg"] },
  { ...base, id: "p007", name: "Malai Paneer", category: "dairy", sub_category: "paneer", pack_size: 200, price: 72, tags: ["veg", "jain"] },
  { ...base, id: "p008", name: "Biryani Masala", category: "masalas_spices", sub_category: "biryani_masala", pack_size: 50, price: 58, tags: ["veg", "vegan"] },
  { ...base, id: "p009", name: "Premium Basmati Rice", brand: "Daawat", category: "atta_rice_dal", sub_category: "basmati_rice", pack_size: 1000, price: 137, tags: ["veg", "vegan", "jain"] },
  // Not food: diets don't apply, so it has no diet tags and fits every diet.
  { ...base, id: "p010", name: "Dishwash Liquid - Lemon", brand: "Vim", category: "cleaning_household", sub_category: "dishwash", unit: "ml", pack_size: 500, price: 105, tags: [] },
];

export const index = indexCatalog(products);
export const search = createMemorySearch(products);
export const deps = { index, products, search };

export const none: Requirements = { budget_inr: null, item_count: null, item_kind: null, must_include: [], diet: null };
const biryani: Requirements = { ...none, must_include: ["chicken"] };

const line = (product_id: string, qty = 1, optional = false) => ({ product_id, qty, optional, included: !optional });

/** Three chicken biryani carts, as the cart builder would return them, rebuilt from the catalog. */
export function biryaniCarts(): AgentCart[] {
  return repriceCarts(
    CartsInputSchema.parse([
      { name: "Budget", items: [line("p002", 2), line("p004"), line("p003"), line("p005", 1, true)], requirements: biryani },
      { name: "Classic", items: [line("p002", 2), line("p004"), line("p003"), line("p008")], requirements: biryani },
      { name: "Premium", items: [line("p002", 3), line("p009"), line("p003"), line("p008")], requirements: biryani },
    ]),
    index,
  ).carts;
}
