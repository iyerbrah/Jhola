import { z } from "zod";

export const CATEGORIES = [
  "dairy",
  "fruits_vegetables",
  "masalas_spices",
  "atta_rice_dal",
  "oils_ghee",
  "breakfast",
  "snacks",
  "chocolates",
  "beverages",
  "eggs_meat",
  "bakery",
  "dry_fruits",
  "sauces_spreads",
  // Household, cleaning and personal care sold with the groceries: no diet tags, and diet rules don't apply to them.
  "personal_care",
  "cleaning_household",
  "baby_care",
  "pet_care",
] as const;

const NON_FOOD_CATEGORIES = ["personal_care", "cleaning_household", "baby_care", "pet_care"] as const;
const NON_FOOD = new Set<string>(NON_FOOD_CATEGORIES);

/** Food is what diets apply to. Soap is never "not vegetarian". */
export function isFood(p: { category: string }): boolean {
  return !NON_FOOD.has(p.category);
}

const UNITS = ["g", "ml", "pcs"] as const;

/** Diet tags: hard filters. Every vegan or jain product is also veg. Food only. */
export const DIET_TAGS = ["veg", "vegan", "jain"] as const;
/** Preference labels: soft words the agent can prefer ("organic", "sugar free"). */
export const LABELS = ["organic", "sugar_free", "high_protein", "whole_grain"] as const;
/** What a food contains that shoppers rule out ("no dairy", "nut allergy", "gluten free"). Food only. */
export const CONTAINS = ["dairy", "egg", "gluten", "nuts", "peanut", "soy"] as const;
export type Contains = (typeof CONTAINS)[number];

const ProductSchema = z.object({
  id: z.string().regex(/^p\d{3,}$/),
  name: z.string().min(2),
  brand: z.string().min(1),
  category: z.enum(CATEGORIES),
  sub_category: z.string().min(2),
  pack_size: z.number().positive(),
  unit: z.enum(UNITS),
  price: z.number().int().positive(),
  in_stock: z.boolean(),
  /** Diet tags and preference labels (DIET_TAGS, LABELS). */
  tags: z.array(z.string()),
  /** Allergens and ingredients a rule can exclude (CONTAINS). */
  contains: z.array(z.enum(CONTAINS)).optional(),
  /** Words shoppers use for the product: Hindi names, everyday terms ("dahi", "cold drink"). */
  search_terms: z.array(z.string()).optional(),
  /** Seller-written text. Untrusted: the agent sees it only through lib/cart/safety.ts. */
  description: z.string().max(300).optional(),
});

export type Product = z.infer<typeof ProductSchema>;
export type Category = (typeof CATEGORIES)[number];
export type Unit = (typeof UNITS)[number];

export const CatalogSchema = z.array(ProductSchema);

/** "200 g", "1 kg" (shown as kg/L when it reads better), "6 pcs" */
export function packLabel(p: Pick<Product, "pack_size" | "unit">): string {
  if (p.unit === "g" && p.pack_size >= 1000) return `${p.pack_size / 1000} kg`;
  if (p.unit === "ml" && p.pack_size >= 1000) return `${p.pack_size / 1000} L`;
  return `${p.pack_size} ${p.unit}`;
}
