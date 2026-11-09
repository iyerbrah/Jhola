import { cartTotal } from "../cartState";
import { DIET_LABELS } from "../requirements";
import type { AgentCart } from "./carts";

export type ItemRef = { product_id: string; name: string; qty: number };

/** What one turn changed in one cart, for the shopper's change list and for Undo. */
export type CartChange = {
  /** 1-based, as the shopper sees it. */
  cart: number;
  name: string;
  removed: ItemRef[];
  added: ItemRef[];
  qty_changed: { product_id: string; name: string; from: number; to: number }[];
  /** Plain-language requirement changes ("now vegetarian", "budget ₹600"). */
  requirements: string[];
  total_before: number;
  total_after: number;
};

/**
 * Compares carts before and after a turn. Works on the end result, not the steps, so an item
 * the agent added and then removed again isn't reported. Carts with no difference are left out.
 */
export function diffCarts(before: AgentCart[], after: AgentCart[]): CartChange[] {
  const changes: CartChange[] = [];
  after.forEach((a, i) => {
    const b = before[i];
    if (!b) return;
    const was = new Map(b.items.map((it) => [it.product_id, it]));
    const now = new Map(a.items.map((it) => [it.product_id, it]));
    const ref = (it: { product_id: string; name: string; qty: number }) => ({ product_id: it.product_id, name: it.name, qty: it.qty });
    const removed = b.items.filter((it) => !now.has(it.product_id)).map(ref);
    const added = a.items.filter((it) => !was.has(it.product_id)).map(ref);
    const qty_changed = a.items.flatMap((it) => {
      const old = was.get(it.product_id);
      return old && old.qty !== it.qty ? [{ product_id: it.product_id, name: it.name, from: old.qty, to: it.qty }] : [];
    });

    const rb = b.requirements;
    const ra = a.requirements;
    const requirements: string[] = [];
    if (rb.diet !== ra.diet) requirements.push(ra.diet ? `now ${DIET_LABELS[ra.diet]}` : "no diet rule");
    if (rb.budget_inr !== ra.budget_inr) requirements.push(ra.budget_inr != null ? `budget ₹${ra.budget_inr}` : "no budget");
    for (const k of rb.must_include) if (!ra.must_include.includes(k)) requirements.push(`no longer needs ${k.replace(/_/g, " ")}`);
    for (const k of ra.must_include) if (!rb.must_include.includes(k)) requirements.push(`now needs ${k.replace(/_/g, " ")}`);

    if (removed.length || added.length || qty_changed.length || requirements.length) {
      changes.push({ cart: i + 1, name: a.name, removed, added, qty_changed, requirements, total_before: cartTotal(b), total_after: cartTotal(a) });
    }
  });
  return changes;
}
