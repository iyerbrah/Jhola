import type { CatalogIndex } from "./catalog";
import type { LlmVariant, Product } from "./schema";

type Item = LlmVariant["items"][number];

/**
 * Whole packs of `p` that cover the item's need. Falls back to the item's own qty when need is 0,
 * or when need ÷ pack size is more than 10 packs: that almost always means the amount is in a
 * different unit from the pack (600 "g" of a product sold as "4 pcs"), not that 150 packs are wanted.
 */
export function packsFor(it: { need: number; qty: number }, p: Product): number {
  const fromNeed = it.need > 0 ? Math.ceil(it.need / p.pack_size - 0.05) : null;
  const n = fromNeed != null && fromNeed <= 10 ? fromNeed : it.qty;
  return Math.min(10, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));
}

/**
 * The cheapest pack size of the same product (same brand and name) that covers the need,
 * e.g. 400 g of rice -> one 1 kg bag (₹84), not one 5 kg bag (₹429). Ties go to less waste.
 */
export function bestPack(it: { need: number; qty: number }, p: Product, products: Product[]): Product {
  if (!(it.need > 0)) return p;
  const siblings = products.filter((x) => x.in_stock && x.brand === p.brand && x.name === p.name && x.unit === p.unit);
  const cost = (x: Product) => x.price * packsFor(it, x);
  const waste = (x: Product) => x.pack_size * packsFor(it, x) - it.need;
  return [p, ...siblings].sort((a, b) => cost(a) - cost(b) || waste(a) - waste(b))[0];
}

/**
 * Fixes mechanical slips in a cart without an LLM call:
 * - an out-of-stock product -> the in-stock product of the same kind closest in price
 * - the pack size -> the cheapest size of that product that covers the amount needed
 * - pack counts -> recomputed from the amount needed (need ÷ pack size, rounded up)
 * - the same product listed twice -> one line with the quantities added (max 10)
 * - qty outside 1-10 or not a whole number -> clamped and rounded
 * Unknown product IDs are left alone: there's nothing to go on, so the repair call handles them.
 */
export function tidyCart(v: LlmVariant, index: CatalogIndex, products: Product[]): LlmVariant {
  const merged = new Map<string, Item>();
  for (const it of v.items) {
    let p = index.get(it.product_id);
    if (p && !p.in_stock) {
      const out = p;
      p =
        products
          .filter((x) => x.in_stock && x.sub_category === out.sub_category && x.unit === out.unit && !merged.has(x.id))
          .sort((a, b) => Math.abs(a.price - out.price) - Math.abs(b.price - out.price))[0] ?? p;
    }
    if (p) p = bestPack(it, p, products);
    const id = p?.id ?? it.product_id;
    const qty = p ? packsFor(it, p) : Math.min(10, Math.max(1, Math.round(Number.isFinite(it.qty) ? it.qty : 1)));
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
