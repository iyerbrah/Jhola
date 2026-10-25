import type { CatalogIndex } from "./catalog";
import { cartTotal } from "./price";
import type { LlmVariant, Product } from "./schema";
import { packsFor } from "./tidy";

type Change = { saving: number; apply: (items: LlmVariant["items"]) => LlmVariant["items"] };

/**
 * Brings an over-budget cart under budget with the smallest changes, without an LLM call:
 * swap a required item for a cheaper in-stock product from the same sub_category with a
 * similar pack size, or lower a qty above 1. Returns the fitted cart, or null if it can't.
 */
export function fitToBudget(v: LlmVariant, budget: number, index: CatalogIndex, products: Product[]): LlmVariant | null {
  let items = v.items.map((it) => ({ ...it }));
  for (let step = 0; step < 20; step++) {
    const total = cartTotal(items, index);
    if (total <= budget) return { ...v, items, model_total_inr: total };

    const inCart = new Set(items.map((it) => it.product_id));
    const changes: Change[] = [];
    items.forEach((it, i) => {
      const p = index.get(it.product_id);
      if (!p || it.optional) return;
      // Cheaper product of the same kind and roughly the same amount.
      for (const alt of products) {
        if (!alt.in_stock || inCart.has(alt.id) || alt.sub_category !== p.sub_category) continue;
        if (alt.unit !== p.unit || alt.pack_size < p.pack_size * 0.75 || alt.price >= p.price) continue;
        const saving = p.price * it.qty - alt.price * packsFor(it, alt);
        if (saving <= 0) continue; // cheaper per pack but more packs needed: no help
        changes.push({
          saving,
          apply: (xs) => xs.map((x, j) => (j === i ? { ...x, product_id: alt.id, qty: packsFor(x, alt) } : x)),
        });
      }
      // One pack fewer.
      if (it.qty > 1) {
        changes.push({ saving: p.price, apply: (xs) => xs.map((x, j) => (j === i ? { ...x, qty: x.qty - 1 } : x)) });
      }
    });
    if (changes.length === 0) return null;

    const over = total - budget;
    const enough = changes.filter((c) => c.saving >= over).sort((a, b) => a.saving - b.saving);
    const best = enough[0] ?? changes.sort((a, b) => b.saving - a.saving)[0];
    items = best.apply(items);
  }
  return null;
}
