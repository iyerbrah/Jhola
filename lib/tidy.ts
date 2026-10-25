import type { CatalogIndex } from "./catalog";
import type { LlmVariant, Product } from "./schema";

/**
 * Fixes mechanical slips in a cart without an LLM call:
 * - pack counts are recomputed from the amount needed (need ÷ pack size, rounded up)
 * - the same product listed twice -> one line with the quantities added (max 10)
 * - qty outside 1-10 or not a whole number -> clamped and rounded
 * - an out-of-stock product -> the in-stock product of the same kind closest in price
 * Unknown product IDs are left alone: there's nothing to go on, so the repair call handles them.
 */
/** Whole packs of `p` that cover the item's need (falls back to the item's qty when need is 0). */
export function packsFor(it: { need: number; qty: number }, p: Product): number {
  const n = it.need > 0 ? Math.ceil(it.need / p.pack_size - 0.05) : it.qty;
  return Math.min(10, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));
}

export function tidyCart(v: LlmVariant, index: CatalogIndex, products: Product[]): LlmVariant {
  const merged = new Map<string, LlmVariant["items"][number]>();
  for (const it of v.items) {
    let id = it.product_id;
    const p = index.get(id);
    if (p && !p.in_stock) {
      const alt = products
        .filter((x) => x.in_stock && x.sub_category === p.sub_category && x.unit === p.unit && !merged.has(x.id))
        .sort((a, b) => Math.abs(a.price - p.price) - Math.abs(b.price - p.price))[0];
      if (alt) id = alt.id;
    }
    // Code does the pack maths: packs = need ÷ pack size, rounded up (e.g. 400 g of 200 g packs = 2).
    const pack = index.get(id);
    const qty = pack ? packsFor(it, pack) : Math.min(10, Math.max(1, Math.round(Number.isFinite(it.qty) ? it.qty : 1)));
    const seen = merged.get(id);
    if (seen) {
      seen.qty = Math.min(10, seen.qty + qty);
      seen.need = seen.need + it.need;
      seen.optional = seen.optional && it.optional; // required wins
    } else {
      merged.set(id, { ...it, product_id: id, qty });
    }
  }
  return { ...v, items: [...merged.values()] };
}
