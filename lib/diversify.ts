import type { CatalogIndex } from "./catalog";
import { cartTotal } from "./price";
import type { LlmVariant, Product } from "./schema";
import { packsFor } from "./tidy";
import { jaccard, MAX_JACCARD } from "./validate";

/** Aim a little below the hard limit so a fixed pair doesn't sit right on the edge. */
const TARGET = MAX_JACCARD - 0.1;

/**
 * Makes carts distinct without an LLM call. When a cart shares too many products with an
 * earlier cart, swap its shared items for another in-stock product of the same kind
 * (sub_category), preferring pricier options since later carts are the higher tiers.
 * Never pushes a cart over the budget. Carts that can't be fixed are left for the repair call.
 */
export function diversify(variants: LlmVariant[], index: CatalogIndex, products: Product[], budget: number | null): LlmVariant[] {
  const out = variants.map((v) => ({ ...v, items: v.items.map((it) => ({ ...it })) }));
  for (let j = 1; j < out.length; j++) {
    for (let i = 0; i < j; i++) {
      for (let step = 0; step < 12 && jaccard(out[i], out[j]) >= TARGET; step++) {
        const earlierIds = new Set(out[i].items.map((it) => it.product_id));
        const used = new Set(out.flatMap((v) => v.items.map((it) => it.product_id)));
        const cart = out[j];
        // Shared required items first (they matter most), then shared optional ones.
        const shared = cart.items.filter((it) => earlierIds.has(it.product_id)).sort((a, b) => Number(a.optional) - Number(b.optional));
        let swapped = false;
        for (const it of shared) {
          const p = index.get(it.product_id);
          if (!p) continue;
          const options = products
            .filter((alt) => alt.in_stock && alt.sub_category === p.sub_category && alt.unit === p.unit && !used.has(alt.id))
            .filter((alt) => alt.pack_size >= p.pack_size * 0.5 && alt.pack_size <= p.pack_size * 2.5)
            // Pricier first (higher tier), closest in price within each direction.
            .sort((a, b) => Number(b.price >= p.price) - Number(a.price >= p.price) || Math.abs(a.price - p.price) - Math.abs(b.price - p.price));
          for (const alt of options) {
            const next = cart.items.map((x) => (x.product_id === it.product_id ? { ...x, product_id: alt.id, qty: packsFor(x, alt), note: "" } : x));
            if (budget != null && cartTotal(next, index) > budget) continue;
            cart.items = next;
            swapped = true;
            break;
          }
          if (swapped) break;
        }
        if (!swapped) break;
      }
    }
  }
  return out;
}
