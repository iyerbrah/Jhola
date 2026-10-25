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
] as const;

export const UNITS = ["g", "ml", "pcs"] as const;

export const ProductSchema = z.object({
  id: z.string().regex(/^p\d{3,}$/),
  name: z.string().min(2),
  brand: z.string().min(1),
  category: z.enum(CATEGORIES),
  sub_category: z.string().min(2),
  pack_size: z.number().positive(),
  unit: z.enum(UNITS),
  price: z.number().int().positive(),
  mrp: z.number().int().positive().optional(),
  in_stock: z.boolean(),
  tags: z.array(z.string()),
});

export type Product = z.infer<typeof ProductSchema>;
export type Category = (typeof CATEGORIES)[number];
export type Unit = (typeof UNITS)[number];

export const CatalogSchema = z.array(ProductSchema);

// ---------- LLM output ----------
// Strict structured output: every field is required, "missing" values are null.
// Two kinds of call: one PLAN call, then one CART call per variant (run in parallel).

export const STATUSES = ["ok", "partial", "cannot_fulfil"] as const;

const ConstraintsSchema = z.object({
  budget_inr: z.number().nullable(),
  item_count: z.number().int().nullable(),
  item_kind: z.string().nullable(),
});

/** Step 1: what to build. No product IDs yet. */
export const PlanSchema = z.object({
  status: z.enum(STATUSES),
  message: z.string(),
  assumptions: z.array(z.string()),
  suggestions: z.array(z.string()),
  constraints: ConstraintsSchema,
  variants: z.array(
    z.object({
      name: z.string(),
      reason: z.string(),
      shopping_list: z.string(),
    }),
  ),
});

export const LlmItemSchema = z.object({
  product_id: z.string(),
  /** How much of this product the cart needs, in the product's unit (g, ml or pcs). 0 = just use qty. */
  need: z.number(),
  /** The model's pack count. Code recomputes it from `need` when it can (see tidyCart). */
  qty: z.number().int(),
  optional: z.boolean(),
  note: z.string(),
});

/** Step 2: one cart, mapped to product IDs. */
export const CartSchema = z.object({
  items: z.array(LlmItemSchema),
  // The model's own sum of non-optional items, written after the items so it
  // actually adds them up (helps it respect budgets). Code never uses it for pricing.
  model_total_inr: z.number(),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanVariant = Plan["variants"][number];
export type Cart = z.infer<typeof CartSchema>;
export type LlmItem = z.infer<typeof LlmItemSchema>;

/** A plan variant joined with its cart. */
export type LlmVariant = { name: string; reason: string } & Cart;

/** The full answer assembled from the plan and the carts. This is what gets validated. */
export type LlmOutput = Omit<Plan, "variants"> & { variants: LlmVariant[] };

// ---------- API ----------

export const BuildCartsRequestSchema = z.object({
  query: z.string().trim().min(3, "Query is too short").max(300, "Query is too long (max 300 characters)"),
});

export type PricedItem = {
  product_id: string;
  name: string;
  brand: string;
  pack_label: string;
  price: number;
  qty: number;
  line_total: number;
  optional: boolean;
  note: string;
  sub_category: string;
};

export type PricedVariant = {
  name: string;
  reason: string;
  items: PricedItem[];
  total: number;
};

export type BuildCartsResponse = {
  status: (typeof STATUSES)[number];
  message: string;
  assumptions: string[];
  suggestions: string[];
  variants: PricedVariant[];
  meta: {
    latency_ms: number;
    model: string;
    repaired: boolean;
    /** True when the answer came from the 24-hour cache (no LLM call). */
    cached?: boolean;
    /** Time spent in each step (plan call, parallel cart calls, repair). */
    steps_ms?: { plan: number; carts: number; repair: number };
    input_tokens: number;
    cached_tokens: number;
    output_tokens: number;
  };
};

/** "200 g", "1 kg" (shown as kg/L when it reads better), "6 pcs" */
export function packLabel(p: Pick<Product, "pack_size" | "unit">): string {
  if (p.unit === "g" && p.pack_size >= 1000) return `${p.pack_size / 1000} kg`;
  if (p.unit === "ml" && p.pack_size >= 1000) return `${p.pack_size / 1000} L`;
  return `${p.pack_size} ${p.unit}`;
}
