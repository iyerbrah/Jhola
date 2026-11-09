/**
 * Carts as the cart editor agent sees them, and the two checks that keep its edits honest:
 *
 * - repriceCarts: the browser sends its carts with every edit request. They are untrusted,
 *   so they're rebuilt from product IDs and quantities alone; every name, price and pack
 *   comes from the catalog. Anything else the browser sends (a price, a total) is ignored.
 * - checkCart: the rules an edited cart must still pass. Item, budget, item-count and
 *   named-ingredient checks are the cart builder's own (lib/validate.ts); diet is new.
 */
import { z } from "zod";
import type { CatalogIndex } from "../catalog";
import { MAX_QTY, type CartItem, type EditableCart } from "../cartState";
import { DIET_LABELS, RequirementsSchema, type Requirements } from "../requirements";
import { packLabel, type LlmVariant, type Product } from "../schema";
import { matchesKind, missingNamed, variantErrors } from "../validate";

export const MAX_CARTS = 3;
export const MAX_ITEMS = 40;

/** Removes control characters (newlines included), so text from the browser stays on one line. */
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

const ItemInputSchema = z.object({
  product_id: z.string().max(12),
  qty: z.number(),
  optional: z.boolean().default(false),
  /** Only optional items can be unticked; required ones always count. */
  included: z.boolean().default(true),
  /** The cart builder's note ("for tadka"). Passed back to the browser, never shown to the model. */
  note: z.string().max(120).default(""),
});

export const CartInputSchema = z.object({
  name: z.string().max(40).transform(oneLine).pipe(z.string().min(1)),
  reason: z.string().max(200).default("").transform(oneLine),
  items: z.array(ItemInputSchema).max(MAX_ITEMS),
  requirements: RequirementsSchema,
});

export const CartsInputSchema = z.array(CartInputSchema).min(1).max(MAX_CARTS);
export type CartInput = z.input<typeof CartInputSchema>;

/** A cart the agent can edit: the UI's editable cart plus what it must satisfy. */
export type AgentCart = EditableCart & { requirements: Requirements };

/** Something repricing had to change in a cart the browser sent. */
export type RepriceNote = { cart: string; product_id: string; problem: string };

/** A cart line built from catalog data only. */
export function toCartItem(p: Product, qty: number, optional: boolean, included: boolean, note = ""): CartItem {
  return {
    product_id: p.id,
    name: p.name,
    brand: p.brand,
    pack_label: packLabel(p),
    price: p.price,
    qty,
    line_total: p.price * qty,
    optional,
    included: optional ? included : true,
    note,
    sub_category: p.sub_category,
  };
}

/**
 * Rebuilds carts from the browser using catalog data only. Unknown products are dropped,
 * a product listed twice keeps its first line, and quantities are rounded into 1-10.
 * Out-of-stock items are kept: checkCart reports them, so the agent can replace them.
 */
export function repriceCarts(input: z.output<typeof CartsInputSchema>, index: CatalogIndex): { carts: AgentCart[]; notes: RepriceNote[] } {
  const notes: RepriceNote[] = [];
  const carts = input.map((c) => {
    const seen = new Set<string>();
    const items: CartItem[] = [];
    for (const it of c.items) {
      const p = index.get(it.product_id);
      if (!p) {
        notes.push({ cart: c.name, product_id: it.product_id, problem: "isn't in the catalog, so it was removed" });
        continue;
      }
      if (seen.has(p.id)) {
        notes.push({ cart: c.name, product_id: p.id, problem: "was listed twice; kept the first line" });
        continue;
      }
      seen.add(p.id);
      const qty = Number.isFinite(it.qty) ? Math.min(MAX_QTY, Math.max(1, Math.round(it.qty))) : 1;
      if (qty !== it.qty) notes.push({ cart: c.name, product_id: p.id, problem: `had quantity ${it.qty}; set to ${qty}` });
      items.push(toCartItem(p, qty, it.optional, it.included, it.note));
    }
    return { name: c.name, reason: c.reason, items, requirements: c.requirements };
  });
  return { carts, notes };
}

/** The cart in the shape the cart builder's rule checks expect: only lines that will be ordered count. */
function asVariant(cart: AgentCart): LlmVariant {
  return {
    name: cart.name,
    reason: cart.reason,
    model_total_inr: 0,
    items: cart.items.filter((it) => it.included).map((it) => ({ product_id: it.product_id, need: 0, qty: it.qty, optional: false, note: "" })),
  };
}

/**
 * Everything that breaks a rule in an edited cart (empty = fine). Messages name the product
 * and the rule, so the agent can act on them and the shopper can read them.
 * The budget counts what will be ordered: required items plus ticked optional ones.
 */
export function checkCart(cart: AgentCart, index: CatalogIndex): string[] {
  const { budget_inr, item_count, item_kind, must_include, diet } = cart.requirements;
  const variant = asVariant(cart);
  const problems = [...variantErrors(variant, { budget_inr, item_count, item_kind }, index), ...missingNamed(variant, must_include, index)];
  for (const m of cart.requirements.min_amounts ?? []) {
    const got = variant.items.reduce((sum, it) => {
      const p = index.get(it.product_id);
      return p && p.unit === m.unit && matchesKind(p, m.kind) ? sum + it.qty * p.pack_size : sum;
    }, 0);
    if (got < m.amount) problems.push(`${cart.name} has ${got} ${m.unit} of ${m.kind}; it needs at least ${m.amount} ${m.unit} to replace what was taken out`);
  }
  if (diet) {
    for (const it of variant.items) {
      const p = index.get(it.product_id);
      if (p && !p.tags.includes(diet)) problems.push(`${cart.name}: ${it.product_id} (${p.name}) isn't ${DIET_LABELS[diet]}`);
    }
  }
  return problems;
}
