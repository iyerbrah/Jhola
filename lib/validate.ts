import type { CatalogIndex } from "./catalog";
import { cartTotal } from "./price";
import type { LlmItem, LlmOutput, LlmVariant, Product } from "./schema";

export const MAX_JACCARD = 0.7;

type Constraints = LlmOutput["constraints"];

/** Problem with a single item, or null if the item is fine. */
function itemError(item: LlmItem, index: CatalogIndex): string | null {
  const p = index.get(item.product_id);
  if (!p) return `${item.product_id} does not exist`;
  if (!p.in_stock) return `${item.product_id} (${p.name}) is out of stock`;
  if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 10) return `${item.product_id} has qty ${item.qty}; qty must be a whole number from 1 to 10`;
  return null;
}

/** Does a product count as the requested kind ("dark_chocolate", "dark chocolate", ...)? */
export function matchesKind(p: Product, kind: string): boolean {
  const k = kind.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (p.sub_category === k || p.tags.includes(k)) return true;
  const text = `${p.name} ${p.sub_category} ${p.tags.join(" ")}`.toLowerCase().replace(/_/g, " ");
  return text.includes(k.replace(/_/g, " ").replace(/s$/, ""));
}

/** Rule problems for one cart (budget, item count, items, duplicates). */
function variantErrors(v: LlmVariant, c: Constraints, index: CatalogIndex): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const item of v.items) {
    const e = itemError(item, index);
    if (e) errors.push(`${v.name}: ${e}`);
    if (seen.has(item.product_id)) errors.push(`${v.name}: ${item.product_id} appears more than once`);
    seen.add(item.product_id);
  }
  if (v.items.filter((i) => !i.optional).length === 0) errors.push(`${v.name}: cart has no required items`);

  if (c.budget_inr != null) {
    const total = cartTotal(v.items, index);
    if (total > c.budget_inr) errors.push(`${v.name} cart is ₹${total}, which is ₹${total - c.budget_inr} over the ₹${c.budget_inr} budget`);
  }

  if (c.item_count != null) {
    const required = v.items.filter((i) => !i.optional);
    const ids = new Set(required.map((i) => i.product_id));
    const kind = c.item_kind;
    const matching = [...ids].filter((id) => {
      const p = index.get(id);
      return p && (!kind || matchesKind(p, kind));
    });
    if (matching.length !== c.item_count || (kind && matching.length !== ids.size)) {
      errors.push(
        `${v.name} cart has ${matching.length} distinct ${kind ?? "items"}${kind ? ` (and ${ids.size - matching.length} other required items)` : ""}; it needs exactly ${c.item_count}`,
      );
    }
  }
  return errors;
}

/** Overlap of two carts' product IDs (0 = nothing shared, 1 = identical). */
export function jaccard(a: { items: { product_id: string }[] }, b: { items: { product_id: string }[] }): number {
  const A = new Set(a.items.map((i) => i.product_id));
  const B = new Set(b.items.map((i) => i.product_id));
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

/**
 * Checks an answer against every rule. Problems that belong to one cart are
 * listed under that cart, so a repair can redo just that cart.
 */
export function checkOutput(out: LlmOutput, index: CatalogIndex): { global: string[]; perVariant: string[][] } {
  if (out.status === "cannot_fulfil") return { global: [], perVariant: [] };

  const global: string[] = [];
  if (out.variants.length !== 3) global.push(`Expected exactly 3 variants, got ${out.variants.length}`);

  const names = out.variants.map((v) => v.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) global.push("Variant names must be distinct");

  const perVariant = out.variants.map((v) => variantErrors(v, out.constraints, index));

  // A cart too similar to an earlier one is the one that has to change.
  for (let i = 0; i < out.variants.length; i++) {
    for (let j = i + 1; j < out.variants.length; j++) {
      const s = jaccard(out.variants[i], out.variants[j]);
      if (s >= MAX_JACCARD) {
        perVariant[j].push(
          `${out.variants[i].name} and ${out.variants[j].name} are too similar (${Math.round(s * 100)}% same products); make them genuinely different`,
        );
      }
    }
  }
  return { global, perVariant };
}

/** All problems as one list (empty = valid). */
export function validate(out: LlmOutput, index: CatalogIndex): string[] {
  const { global, perVariant } = checkOutput(out, index);
  return [...global, ...perVariant.flat()];
}

/**
 * Last-resort cleanup after a failed repair: drop bad and duplicate items,
 * then keep only carts that pass their own rules.
 */
export function salvage(out: LlmOutput, index: CatalogIndex): { variants: LlmVariant[]; dropped: number } {
  let dropped = 0;
  const cleaned = out.variants.map((v) => {
    const seen = new Set<string>();
    const items = v.items.filter((item) => {
      const ok = !itemError(item, index) && !seen.has(item.product_id);
      seen.add(item.product_id);
      if (!ok) dropped++;
      return ok;
    });
    return { ...v, items };
  });
  const variants = cleaned.filter((v) => variantErrors(v, out.constraints, index).length === 0);
  return { variants, dropped };
}
