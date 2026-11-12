import { indexCatalog } from "@/lib/catalog";
import type { Brief, Need, Session } from "@/lib/cart/types";
import type { Product } from "@/lib/schema";

let n = 900;
const p = (o: Partial<Product> & Pick<Product, "name" | "brand" | "category" | "sub_category" | "pack_size" | "unit" | "price">): Product => ({
  id: `p${n++}`,
  in_stock: true,
  tags: o.category === "eggs_meat" ? [] : ["veg", "vegan", "jain"],
  ...o,
});

/** A small catalog with every case the solver handles: sizes, brands, stock-outs, diets, misfilings, non-food. */
export const products: Product[] = [
  p({ name: "Penne Pasta", brand: "Keya", category: "breakfast", sub_category: "pasta", pack_size: 400, unit: "g", price: 70 }),
  p({ name: "Durum Wheat Penne", brand: "San Vito", category: "breakfast", sub_category: "pasta", pack_size: 500, unit: "g", price: 108 }),
  p({ name: "Organic Penne", brand: "Wingreens", category: "breakfast", sub_category: "pasta", pack_size: 400, unit: "g", price: 160 }),
  p({ name: "Fusilli Pasta", brand: "Keya", category: "breakfast", sub_category: "pasta", pack_size: 1000, unit: "g", price: 150 }),
  p({ name: "Tomato - Local", brand: "Fresho", category: "fruits_vegetables", sub_category: "tomato", pack_size: 500, unit: "g", price: 20 }),
  p({ name: "Tomato - Hybrid", brand: "Fresho", category: "fruits_vegetables", sub_category: "tomato", pack_size: 1000, unit: "g", price: 36 }),
  p({ name: "Onion", brand: "Fresho", category: "fruits_vegetables", sub_category: "onion", pack_size: 1000, unit: "g", price: 40 }),
  p({ name: "Onion & Tomato Masala", brand: "MDH", category: "masalas_spices", sub_category: "tomato", pack_size: 100, unit: "g", price: 55 }),
  p({ name: "Fresh Cream", brand: "Amul", category: "dairy", sub_category: "cream", pack_size: 250, unit: "ml", price: 67 }),
  p({ name: "Moonfils - Orange Cream", brand: "Bauli", category: "bakery", sub_category: "cream", pack_size: 50, unit: "g", price: 13 }),
  p({ name: "Fresh Cream", brand: "Mother Dairy", category: "dairy", sub_category: "cream", pack_size: 250, unit: "ml", price: 72 }),
  p({ name: "Cheese Slices", brand: "Amul", category: "dairy", sub_category: "cheese", pack_size: 200, unit: "g", price: 130 }),
  p({ name: "Cheese Cubes", brand: "D'Lecta", category: "dairy", sub_category: "cheese", pack_size: 200, unit: "g", price: 109 }),
  p({ name: "Garlic", brand: "Fresho", category: "fruits_vegetables", sub_category: "garlic", pack_size: 250, unit: "g", price: 21 }),
  p({ name: "Garlic", brand: "Fresho", category: "fruits_vegetables", sub_category: "garlic", pack_size: 1000, unit: "g", price: 70 }),
  p({ name: "Basil", brand: "HappyChef", category: "masalas_spices", sub_category: "herbs_seasoning", pack_size: 25, unit: "g", price: 79 }),
  p({ name: "Italian Spice Mix", brand: "Keya", category: "masalas_spices", sub_category: "herbs_seasoning", pack_size: 75, unit: "g", price: 69 }),
  p({ name: "Olive Oil", brand: "Sol", category: "oils_ghee", sub_category: "cooking_oil", pack_size: 100, unit: "ml", price: 126 }),
  p({ name: "Sunflower Oil", brand: "Fortune", category: "oils_ghee", sub_category: "cooking_oil", pack_size: 1000, unit: "ml", price: 160 }),
  p({ name: "Fresh Paneer", brand: "Amul", category: "dairy", sub_category: "paneer", pack_size: 200, unit: "g", price: 95, tags: ["veg", "high_protein"] }),
  p({ name: "Malai Paneer", brand: "Milky Mist", category: "dairy", sub_category: "paneer", pack_size: 200, unit: "g", price: 110, tags: ["veg", "high_protein"] }),
  p({ name: "Chicken Curry Cut", brand: "Fresho", category: "eggs_meat", sub_category: "chicken", pack_size: 450, unit: "g", price: 190 }),
  p({ name: "Chicken Breast", brand: "Fresho", category: "eggs_meat", sub_category: "chicken", pack_size: 450, unit: "g", price: 260 }),
  p({ name: "Dark Chocolate 70%", brand: "Amul", category: "chocolates", sub_category: "dark_chocolate", pack_size: 150, unit: "g", price: 200 }),
  p({ name: "Dark Chocolate 55%", brand: "Bournville", category: "chocolates", sub_category: "dark_chocolate", pack_size: 80, unit: "g", price: 100 }),
  p({ name: "Dark Chocolate 85%", brand: "Lindt", category: "chocolates", sub_category: "dark_chocolate", pack_size: 100, unit: "g", price: 340 }),
  p({ name: "Dark Chocolate Orange", brand: "Lindt", category: "chocolates", sub_category: "dark_chocolate", pack_size: 100, unit: "g", price: 320 }),
  p({ name: "Dishwash Gel", brand: "Vim", category: "cleaning_household", sub_category: "dishwash", pack_size: 500, unit: "ml", price: 105, tags: [] }),
  p({ name: "Organic Penne - Out of stock", brand: "Wingreens", category: "breakfast", sub_category: "pasta", pack_size: 500, unit: "g", price: 150, in_stock: false }),
];
export const index = indexCatalog(products);
export const ctx = { products, index };
export const byName = (name: string, brand?: string) => products.find((x) => x.name === name && (!brand || x.brand === brand))!;

export function brief(o: Partial<Brief> = {}): Brief {
  return { summary: "", people: 4, budget_inr: null, diet: null, quality: "balanced", rules: [], assumptions: [], plan: [], ...o };
}

export function need(id: string, kind: string, amount: number, unit: Need["unit"], o: Partial<Need> = {}): Need {
  return { id, group: "main", label: id[0].toUpperCase() + id.slice(1), kind, amount, unit, per_person: true, role: "core", ticked: true, count: null, prefer: null, why: "", confidence: "sure", ...o };
}

export function session(needs: Need[], b: Partial<Brief> = {}, o: Partial<Session> = {}): Session {
  return { brief: brief(b), needs, pins: [], picks: {}, choices: {}, ...o };
}

/** The pasta-night needs used across tests. */
export function pastaNeeds(): Need[] {
  return [
    need("pasta", "pasta", 100, "g", { role: "main" }),
    need("tomato", "tomato", 125, "g"),
    need("cream", "cream", 30, "ml", { prefer: "fresh cream" }),
    need("cheese", "cheese", 25, "g"),
    need("garlic", "garlic", 15, "g", { per_person: false }),
    need("basil", "herbs_seasoning", 1, "pack", { per_person: false, role: "extra", prefer: "basil" }),
    need("oil", "cooking_oil", 15, "ml", { role: "pantry", ticked: false }),
  ];
}
