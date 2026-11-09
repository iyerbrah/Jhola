import { isSameKind } from "./kind";
import { packLabel, type PricedItem, type PricedVariant, type Product } from "./schema";

/** A cart the shopper can edit. Optional items count only when ticked (`included`). */
export type CartItem = PricedItem & { included: boolean };
export type EditableCart = { name: string; reason: string; items: CartItem[] };

export const MAX_QTY = 10;

export function toEditable(v: PricedVariant): EditableCart {
  return {
    name: v.name,
    reason: v.reason,
    // Optional pantry items start unticked; required items always count.
    items: v.items.map((it) => ({ ...it, included: !it.optional })),
  };
}

export function cartTotal(cart: EditableCart): number {
  return cart.items.reduce((sum, it) => (it.included ? sum + it.price * it.qty : sum), 0);
}

/** Items that will be ordered: required ones plus ticked optional ones. */
export function orderedItems(cart: EditableCart): CartItem[] {
  return cart.items.filter((it) => it.included);
}

// Generic, so a cart with extra fields (the agent's requirements) keeps them through an edit.
const update = <C extends EditableCart>(cart: C, id: string, fn: (it: CartItem) => CartItem): C => ({
  ...cart,
  items: cart.items.map((it) => (it.product_id === id ? fn(it) : it)),
});

export function setQty<C extends EditableCart>(cart: C, id: string, qty: number): C {
  const q = Math.min(MAX_QTY, Math.max(1, Math.round(qty)));
  return update(cart, id, (it) => ({ ...it, qty: q, line_total: it.price * q }));
}

export function removeItem<C extends EditableCart>(cart: C, id: string): C {
  return { ...cart, items: cart.items.filter((it) => it.product_id !== id) };
}

export function toggleOptional<C extends EditableCart>(cart: C, id: string): C {
  return update(cart, id, (it) => (it.optional ? { ...it, included: !it.included } : it));
}

/** Replace a product with another from the catalog, keeping qty and optional/ticked state. */
export function swapItem<C extends EditableCart>(cart: C, id: string, p: Product): C {
  return update(cart, id, (it) => ({
    ...it,
    product_id: p.id,
    name: p.name,
    brand: p.brand,
    pack_label: packLabel(p),
    price: p.price,
    line_total: p.price * it.qty,
    sub_category: p.sub_category,
    note: "",
  }));
}

/**
 * In-stock products of the same kind that aren't already in the cart, cheapest first.
 * "Same kind" means same sub_category, unit and form, so rice never offers rice flour.
 */
export function swapOptions(cart: EditableCart, item: CartItem, catalog: Product[]): Product[] {
  const inCart = new Set(cart.items.map((it) => it.product_id));
  const current = catalog.find((p) => p.id === item.product_id);
  return catalog
    .filter((p) => p.in_stock && !inCart.has(p.id) && (current ? isSameKind(current, p) : p.sub_category === item.sub_category))
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}
