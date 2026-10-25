import type { CatalogIndex } from "./catalog";
import { packLabel, type LlmVariant, type PricedVariant } from "./schema";

/** Sum of price × qty for the non-optional items. Unknown products count as 0. */
export function cartTotal(items: { product_id: string; qty: number; optional: boolean }[], index: CatalogIndex): number {
  return items.reduce((sum, it) => {
    const p = index.get(it.product_id);
    return it.optional || !p ? sum : sum + p.price * it.qty;
  }, 0);
}

/**
 * Turns the LLM's picks into priced carts using catalog data only.
 * Expects already-validated variants: unknown products are skipped.
 */
export function priceVariants(variants: LlmVariant[], index: CatalogIndex): PricedVariant[] {
  return variants.map((v) => {
    const items = v.items.flatMap((it) => {
      const p = index.get(it.product_id);
      if (!p) return [];
      return [
        {
          product_id: p.id,
          name: p.name,
          brand: p.brand,
          pack_label: packLabel(p),
          price: p.price,
          qty: it.qty,
          line_total: p.price * it.qty,
          optional: it.optional,
          note: it.note,
          sub_category: p.sub_category,
        },
      ];
    });
    const total = items.reduce((sum, it) => (it.optional ? sum : sum + it.line_total), 0);
    return { name: v.name, reason: v.reason, items, total };
  });
}
