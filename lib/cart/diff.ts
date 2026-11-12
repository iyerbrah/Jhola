/**
 * What changed between two carts, for the change list after every message ("+2 pasta packs, −cream,
 * ₹612 → ₹745"), for Undo, and for the eval's collateral-change rate.
 */
import type { Cart, Line } from "./types";

export type LineRef = { product_id: string; name: string; packs: number };

export type CartDiff = {
  added: LineRef[];
  removed: LineRef[];
  /** Same need, different product. */
  swapped: { need_id: string; from: LineRef; to: LineRef }[];
  /** Same product, different packs. */
  packs: { product_id: string; name: string; from: number; to: number }[];
  total_before: number;
  total_after: number;
};

const ref = (l: Line): LineRef => ({ product_id: l.product.id, name: l.product.name, packs: l.packs });

/** Compares the counted lines of two carts (unticked suggestions don't count as changes). */
export function diffCarts(before: Cart | null, after: Cart): CartDiff {
  const was = (before?.lines ?? []).filter((l) => l.counted);
  const now = after.lines.filter((l) => l.counted);
  const wasById = new Map(was.map((l) => [l.product.id, l]));
  const nowById = new Map(now.map((l) => [l.product.id, l]));
  const gone = was.filter((l) => !nowById.has(l.product.id));
  const fresh = now.filter((l) => !wasById.has(l.product.id));

  const swapped: CartDiff["swapped"] = [];
  for (const l of [...fresh]) {
    const old = gone.find((g) => g.need_id === l.need_id);
    if (!old) continue;
    swapped.push({ need_id: l.need_id, from: ref(old), to: ref(l) });
    gone.splice(gone.indexOf(old), 1);
    fresh.splice(fresh.indexOf(l), 1);
  }
  const packs = now.flatMap((l) => {
    const old = wasById.get(l.product.id);
    return old && old.packs !== l.packs ? [{ product_id: l.product.id, name: l.product.name, from: old.packs, to: l.packs }] : [];
  });
  return { added: fresh.map(ref), removed: gone.map(ref), swapped, packs, total_before: before?.total ?? 0, total_after: after.total };
}

export function isEmptyDiff(d: CartDiff): boolean {
  return !d.added.length && !d.removed.length && !d.swapped.length && !d.packs.length;
}

/** "+2 × Penne, −Fresh Cream, Basmati Rice 1 → 2, Amul Butter → Mother Dairy Butter" */
export function describeDiff(d: CartDiff): string {
  const n = (r: LineRef) => `${r.packs > 1 ? `${r.packs} × ` : ""}${r.name}`;
  return [
    ...d.added.map((r) => `+${n(r)}`),
    ...d.removed.map((r) => `−${r.name}`),
    ...d.swapped.map((s) => `${s.from.name} → ${s.to.name}`),
    ...d.packs.map((p) => `${p.name} ${p.from} → ${p.to}`),
  ].join(", ");
}

/** Lines changed that the edit didn't ask about: changes to lines outside `asked` (need ids). */
export function collateral(d: CartDiff, before: Cart | null, after: Cart, asked: Set<string>): number {
  const needOf = new Map<string, string>();
  for (const l of [...(before?.lines ?? []), ...after.lines]) needOf.set(l.product.id, l.need_id);
  const touched = [
    ...d.added.map((r) => needOf.get(r.product_id)),
    ...d.removed.map((r) => needOf.get(r.product_id)),
    ...d.swapped.map((s) => s.need_id),
    ...d.packs.map((p) => needOf.get(p.product_id)),
  ];
  return touched.filter((id) => id != null && !asked.has(id)).length;
}
