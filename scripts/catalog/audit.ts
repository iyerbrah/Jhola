/**
 * Rows worth a second look in data/grocery.csv: not errors (the build catches those), but likely misfilings
 * or bad source data. Printed as warnings by npm run catalog:coverage, for a person to review.
 */
import type { Product } from "../../lib/schema";

export type Suspect = { id: string; name: string; kind: string; why: string };

/** Names too bare to tell a shopper what they're buying ("Organic", "Meat"). */
const BARE = /^(organic|fresh|natural|meat|cleaning|kitchen|regular|plain|assorted)$/i;
/** A product priced at this many times its kind's median per unit is probably a misread pack. */
const PRICE_FACTOR = 8;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function auditCatalog(products: Product[]): Suspect[] {
  const out: Suspect[] = [];
  const perUnit = new Map<string, number[]>();
  for (const p of products) perUnit.set(`${p.sub_category}|${p.unit}`, [...(perUnit.get(`${p.sub_category}|${p.unit}`) ?? []), p.price / p.pack_size]);
  const medians = new Map([...perUnit].filter(([, v]) => v.length >= 4).map(([k, v]) => [k, median(v)]));
  for (const p of products) {
    if (BARE.test(p.name.trim())) out.push({ id: p.id, name: p.name, kind: p.sub_category, why: "name too bare" });
    const m = medians.get(`${p.sub_category}|${p.unit}`);
    if (m && p.price / p.pack_size > PRICE_FACTOR * m) out.push({ id: p.id, name: p.name, kind: p.sub_category, why: `priced ${Math.round(p.price / p.pack_size / m)}x the kind's median per ${p.unit}` });
  }
  return out;
}
