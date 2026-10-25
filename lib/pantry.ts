import type { CatalogIndex } from "./catalog";
import type { LlmVariant } from "./schema";

/** Staples most kitchens already have. Shown under "You may already have", unticked. */
export const PANTRY_SUB_CATEGORIES: Record<string, string[]> = {
  salt: ["salt"],
  cooking_oil: ["oil"],
  sugar: ["sugar"],
  turmeric: ["turmeric", "haldi"],
  chilli_powder: ["chilli powder", "chilly powder", "mirch"],
  cumin: ["cumin", "jeera"],
  mustard: ["mustard", "rai"],
  garam_masala: ["garam masala"],
};

/**
 * Marks pantry staples optional, unless the shopper asked for that item by name
 * ("jeera rice" keeps cumin required; "buy salt" keeps salt required).
 */
export function markPantryOptional(v: LlmVariant, query: string, index: CatalogIndex): LlmVariant {
  const q = query.toLowerCase();
  const items = v.items.map((it) => {
    if (it.optional) return it;
    const sub = index.get(it.product_id)?.sub_category;
    const words = sub ? PANTRY_SUB_CATEGORIES[sub] : undefined;
    if (!words || words.some((w) => q.includes(w))) return it;
    return { ...it, optional: true, note: "" };
  });
  // A cart must keep at least one required item (e.g. a request for spices only).
  return items.some((it) => !it.optional) ? { ...v, items } : v;
}
