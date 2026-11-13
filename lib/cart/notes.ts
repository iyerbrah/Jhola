/**
 * The end note under each reply: what Jhola couldn't find, what it swapped, what it guessed.
 * Written by code from the cart itself, so it is always complete and always true.
 */
import { amountLabel, type Cart, type Session } from "./types";

const money = (n: number) => `₹${Math.abs(n)}`;

export function endNote(session: Session, cart: Cart): string[] {
  const { brief, needs } = session;
  const notes: string[] = [];

  for (const l of cart.lines) {
    const s = l.substitution;
    if (!s) continue;
    const size = s.wanted.pack_label === l.product.pack_label ? "same size" : l.product.pack_label;
    const price = s.delta_inr === 0 ? "same price" : `${money(s.delta_inr)} ${s.delta_inr > 0 ? "more" : "less"}`;
    notes.push(`${s.wanted.brand} ${s.wanted.name} is out of stock, so I picked ${l.product.brand} ${l.product.name} (${size}, ${price}).`);
  }
  for (const u of cart.unmet) notes.push(`Couldn't add ${u.label.toLowerCase()}: ${u.detail}.`);
  // Things the shopper should know about a line: it's sold another way, a preference had no match in stock,
  // fewer different products than asked. Counted lines only, each said once.
  const said = new Set<string>();
  for (const l of cart.lines.filter((x) => x.counted)) {
    for (const w of l.warnings) {
      if (said.has(w) || !/^(Sold |No "|Only \d)/.test(w)) continue;
      said.add(w);
      notes.push(`${l.label}: ${w.charAt(0).toLowerCase()}${w.slice(1)}.`);
    }
  }
  const have = cart.skipped.filter((s) => s.reason === "have");
  const ruled = cart.skipped.filter((s) => s.reason === "rule");
  for (const s of have) notes.push(`Skipped ${s.label.toLowerCase()}, since you have it.`);
  if (ruled.length) notes.push(`Left out ${list(ruled.map((s) => `${s.label.toLowerCase()} (${s.rule})`))}.`);
  if (cart.dropped.length && brief.budget_inr != null) {
    notes.push(`Left out ${list(cart.dropped.map((d) => d.label.toLowerCase()))} to stay within ₹${brief.budget_inr}.`);
  }
  if (brief.budget_inr != null && cart.total > brief.budget_inr) {
    notes.push(`I can't get this under ₹${brief.budget_inr} without removing something the dish needs: the lowest is ₹${cart.floor_inr}.`);
  }

  const guessed = needs.filter((n) => n.confidence === "guess" && n.ticked && cart.lines.some((l) => l.need_id === n.id && l.needed));
  if (guessed.length) {
    const parts = guessed.slice(0, 3).map((n) => {
      const line = cart.lines.find((l) => l.need_id === n.id)!;
      return `${amountLabel(line.needed!.amount, line.needed!.unit)} ${n.label.toLowerCase()}`;
    });
    const who = brief.people ? ` for ${brief.people}` : "";
    notes.push(`Guessed ${list(parts)}${who}; change ${guessed.length === 1 ? "it" : "them"} if needed.`);
  }
  return notes;
}

function list(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}
