/**
 * The agent's goal, as one check: did the chat end with a cart the shopper could order as it is?
 * Used by the eval (every scripted chat) and by the live site's request log (every real turn), so both
 * measure accuracy the same way. Pure: catalogue index in, reasons out.
 */
import type { CatalogIndex } from "../catalog";
import { namesWord } from "./quality";
import { planCoverage, review } from "./review";
import type { Cart, Session } from "./types";

/** What a finished turn needs to be judged: how it ended, the reply, the session and its cart, the end note. */
export type TurnEnd = { status: string; stop_reason: string; reply: string; session: Session; cart: Cart; note: string[] };

/**
 * Is this the cart the shopper asked for, ready to order as it is? Every reason it isn't, in plain words.
 * - The turn finished (not waiting for a yes, not given up) and the agent replied.
 * - The cart has something in it, and every counted line is in stock at the catalogue's price.
 * - The cart's own checklist has no failure: diet, avoid, every rule, budget, amounts covered, no duplicates.
 * - Nothing planned was lost: every required line of the agent's shopping list became a need, and every main or core
 *   need has a product (an item the store doesn't sell may be missing only if `allowUnmet` names it and the
 *   end note tells the shopper).
 * - No counted line is bought in a unit it can't be measured in ("sold by the piece, bought 1 pack").
 */
export function readyToOrder(r: TurnEnd, index: CatalogIndex, allowUnmet: string[] = []): string[] {
  const problems: string[] = [];
  if (r.status !== "done") problems.push(`the turn ended ${r.status} (${r.stop_reason})`);
  if (!r.reply.trim()) problems.push("no reply");
  const lines = r.cart.lines.filter((l) => l.counted);
  if (!lines.length) problems.push("the cart is empty");
  const stale = lines.filter((l) => {
    const p = index.get(l.product.id);
    return !p || !p.in_stock || p.price !== l.product.price;
  });
  if (stale.length) problems.push(`not orderable as listed: ${stale.map((l) => l.product.name).join(", ")}`);
  for (const c of review(r.session, r.cart, index)) if (c.status === "fail") problems.push(`checklist: ${c.label}`);
  // Optional lines may be left out; required ones must each have a need (kinds' shopper words count: "doodh").
  const aliases = (kind: string) => [...index.values()].find((p) => p.sub_category === kind)?.search_terms ?? [];
  const unlisted = planCoverage((r.session.brief.plan ?? []).filter((l) => !/\(optional\)/i.test(l)), r.session.needs, aliases);
  if (unlisted.length) problems.push(`planned but not in the cart: ${unlisted.join(", ")}`);
  const said = r.note.join(" ").toLowerCase();
  const allowed = (label: string) => allowUnmet.some((w) => namesWord(label, w)) && said.includes(label.toLowerCase());
  for (const u of r.cart.unmet) {
    const need = r.session.needs.find((n) => n.id === u.need_id);
    if (need && need.ticked && need.role !== "extra" && need.role !== "pantry" && !allowed(u.label)) problems.push(`no product for ${u.label.toLowerCase()} (${u.detail})`);
  }
  const unitSlips = lines.filter((l) => l.warnings.some((w) => w.startsWith("Sold ")));
  if (unitSlips.length) problems.push(`bought in the wrong unit: ${unitSlips.map((l) => l.label.toLowerCase()).join(", ")}`);
  return problems;
}

