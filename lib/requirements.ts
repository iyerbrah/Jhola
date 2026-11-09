import { z } from "zod";

/** Diets the catalog tags products with. Every jain or vegan product is also tagged veg. */
export const DIETS = ["veg", "vegan", "jain"] as const;
export type Diet = (typeof DIETS)[number];

export const DIET_LABELS: Record<Diet, string> = { veg: "vegetarian", vegan: "vegan", jain: "Jain" };

/**
 * What a cart has to satisfy. It starts from the shopper's request (worked out by the plan
 * call) and later changes only when the shopper asks for something new (e.g. "make it veg").
 * Sent to the browser with the carts, and back with every edit request.
 */
export const RequirementsSchema = z.object({
  budget_inr: z.number().int().positive().max(1_000_000).nullable(),
  /** Exact number of distinct products, e.g. "4 dark chocolates". */
  item_count: z.number().int().min(1).max(30).nullable(),
  /** What the counted products must be, e.g. "dark_chocolate". */
  item_kind: z.string().max(40).nullable(),
  /** Kinds of product every cart must contain, e.g. ["chicken"] for "chicken biryani". */
  must_include: z.array(z.string().max(40)).max(5),
  diet: z.enum(DIETS).nullable(),
});

export type Requirements = z.infer<typeof RequirementsSchema>;

/** The plan's constraints and named ingredients as requirements. The plan never sets a diet. */
export function requirementsFromPlan(plan: {
  constraints: { budget_inr: number | null; item_count: number | null; item_kind: string | null };
  must_include?: string[];
}): Requirements {
  const { budget_inr, item_count, item_kind } = plan.constraints;
  const whole = (n: number | null) => (n != null && n >= 1 ? Math.floor(n) : null);
  return {
    budget_inr: whole(budget_inr),
    item_count: whole(item_count),
    item_kind: item_kind || null,
    must_include: (plan.must_include ?? []).slice(0, 5),
    diet: null,
  };
}
