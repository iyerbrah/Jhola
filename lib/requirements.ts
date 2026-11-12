/** Diets: what the catalog tags food with, and how a cart is checked against them. */
import { isFood } from "./schema";

/** Diets the catalog tags products with. Every jain or vegan product is also tagged veg. */
export const DIETS = ["veg", "vegan", "jain"] as const;
export type Diet = (typeof DIETS)[number];

export const DIET_LABELS: Record<Diet, string> = { veg: "vegetarian", vegan: "vegan", jain: "Jain" };

/** True if a product suits a diet. Diets are about food, so every non-food product suits every diet. */
export function fitsDiet(p: { category: string; tags: string[] }, diet: Diet): boolean {
  return !isFood(p) || p.tags.includes(diet);
}

/** Tags as the agent sees them: non-food is marked, so it knows diets don't apply. */
export function shownTags(p: { category: string; tags: string[] }): string[] {
  return isFood(p) ? p.tags : ["non_food"];
}
