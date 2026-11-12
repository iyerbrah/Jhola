/**
 * How "premium" a product is within its kind, from catalog data alone (the catalog has no ratings):
 * where its price per gram, ml or piece falls among the other products of its kind, nudged by
 * name and brand words that mark a premium or a budget line.
 */
import type { Product } from "../schema";
import type { Quality } from "./types";

/** Where each quality setting aims, as a quality score (0 = cheapest per unit, 1 = priciest). */
export const QUALITY_TARGET: Record<Quality, number> = { value: 0.15, balanced: 0.5, premium: 0.9 };

const PREMIUM_WORDS = /\b(premium|organic|gold|signature|luxury|select|royal|extra virgin|cold pressed|artisan|imported)\b/i;
const BUDGET_WORDS = /\b(super saver|economy|value pack|popular|bachat)\b/i;
const WORD_NUDGE = 0.15;

const cache = new WeakMap<Product[], Map<string, number>>();

/** Price per unit percentile within the kind, 0..1. A kind with one product scores 0.5. */
function percentiles(products: Product[]): Map<string, number> {
  const byKind = new Map<string, Product[]>();
  for (const p of products) byKind.set(p.sub_category, [...(byKind.get(p.sub_category) ?? []), p]);
  const out = new Map<string, number>();
  for (const ps of byKind.values()) {
    const unit = (p: Product) => p.price / p.pack_size;
    const sorted = [...ps].sort((a, b) => unit(a) - unit(b) || a.id.localeCompare(b.id));
    // Products at the same price per unit (a 1 kg and a 2 kg bag of the same onions) score the same.
    sorted.forEach((p) => {
      const first = sorted.findIndex((x) => Math.abs(unit(x) - unit(p)) < 1e-9);
      const last = sorted.length - 1 - [...sorted].reverse().findIndex((x) => Math.abs(unit(x) - unit(p)) < 1e-9);
      out.set(p.id, sorted.length === 1 ? 0.5 : (first + last) / 2 / (sorted.length - 1));
    });
  }
  return out;
}

/** The product's quality score within its kind, 0..1. */
export function qualityScore(p: Product, products: Product[]): number {
  let map = cache.get(products);
  if (!map) cache.set(products, (map = percentiles(products)));
  const text = `${p.name} ${p.brand}`;
  const nudge = (PREMIUM_WORDS.test(text) ? WORD_NUDGE : 0) - (BUDGET_WORDS.test(text) ? WORD_NUDGE : 0);
  return Math.min(1, Math.max(0, (map.get(p.id) ?? 0.5) + nudge));
}

const NAME_STOP = new Set(["and", "with", "the", "for", "pack", "pcs", "of", "in", "a", "fresh", "premium", "organic", "classic", "original", "new", "pure", "natural"]);
const nameWords = (p: Product) => new Set((p.name.toLowerCase().match(/[a-z]{3,}/g) ?? []).map(singular).filter((w) => !NAME_STOP.has(w)));
const typicalCache = new WeakMap<Product[], Map<string, number>>();

/**
 * How typical a product is of its kind (0..1): the share of the kind's products that share its most
 * common name word. Learned from the catalog, so it needs no list of exceptions: in "bread", sandwich,
 * brown and whole wheat bread share "bread", while ladi pav and dry yeast share nothing and score low.
 */
export function typicality(p: Product, products: Product[]): number {
  let map = typicalCache.get(products);
  if (!map) {
    map = new Map();
    const byKind = new Map<string, Product[]>();
    for (const x of products) byKind.set(x.sub_category, [...(byKind.get(x.sub_category) ?? []), x]);
    for (const ps of byKind.values()) {
      // Count each word once per product name (sizes of one product share a name, so names are deduplicated).
      const names = [...new Map(ps.map((x) => [x.name.toLowerCase(), x])).values()];
      const df = new Map<string, number>();
      for (const x of names) for (const w of nameWords(x)) df.set(w, (df.get(w) ?? 0) + 1);
      for (const x of ps) {
        const best = Math.max(0, ...[...nameWords(x)].map((w) => df.get(w) ?? 0));
        map.set(x.id, names.length <= 1 ? 1 : (best - 1) / (names.length - 1));
      }
    }
    typicalCache.set(products, map);
  }
  return map.get(p.id) ?? 0.5;
}

/**
 * How plain a product's name is for what it is (0..1): the share of its name words that are the kind's
 * or the need's own words. "Onion" is 1; "Sambar Onion - Peeled (Small Onion)" is 0.25; "Anti Dandruff
 * Shampoo" is a third. The plain product is what a shopper means unless they say otherwise.
 */
export function plainness(p: Product, label: string): number {
  const own = [...new Set([...(p.sub_category.match(/[a-z]{3,}/g) ?? []), ...(label.toLowerCase().match(/[a-z]{3,}/g) ?? [])].map(singular))];
  const words = [...nameWords(p)];
  if (!words.length) return 0;
  // "Handwash" is the kind "hand wash" written as one word.
  const isOwn = (w: string) => own.some((o) => o === w || (o.length >= 4 && w.includes(o)));
  const share = words.filter(isOwn).length / words.length;
  // A treatment or special-purpose variant (anti-dandruff, hair fall, a refill, a men's line) is what
  // someone asks for by name; unasked, it counts as half as plain.
  const special = SPECIAL.test(p.name) && !SPECIAL.test(label);
  return special ? share / 2 : share;
}

const SPECIAL = /\b(anti[- ]?\w*|dandruff|hair ?fall|damage|repair|therapy|refill|kit|combo|for men|men'?s|\bman\b)\b/i;

const sizeCache = new WeakMap<Product[], Map<string, number>>();
/**
 * How unusual a product's pack is for its kind, as doublings away from the kind's typical size (0 = the
 * usual size, up to 2). A product sold in a unit few of its kind use (a 9 g handwash powder among
 * liquid handwashes) counts as fully unusual.
 */
export function oddSize(p: Product, products: Product[]): number {
  let map = sizeCache.get(products);
  if (!map) {
    map = new Map();
    const by = new Map<string, Product[]>();
    for (const x of products) by.set(x.sub_category, [...(by.get(x.sub_category) ?? []), x]);
    for (const ps of by.values()) {
      const counts = new Map<string, number>();
      for (const x of ps) counts.set(x.unit, (counts.get(x.unit) ?? 0) + 1);
      const main = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const sizes = ps.filter((x) => x.unit === main).map((x) => x.pack_size).sort((a, b) => a - b);
      const typical = sizes[Math.floor(sizes.length / 2)];
      for (const x of ps) map.set(x.id, x.unit !== main ? 2 : Math.min(2, Math.abs(Math.log2(x.pack_size / typical))));
    }
    sizeCache.set(products, map);
  }
  return map.get(p.id) ?? 0;
}

/** How well a product matches a need's preference words (0..1): the share of the words in its name, kind or tags. */
export function preferScore(p: Product, prefer: string | null): number {
  if (!prefer) return 0;
  const words = prefer.toLowerCase().match(/[a-z0-9%]+/g)?.filter((w) => w.length > 1) ?? [];
  if (!words.length) return 0;
  const text = `${p.name} ${p.sub_category.replace(/_/g, " ")} ${p.tags.join(" ").replace(/_/g, " ")}`.toLowerCase();
  const hit = words.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9%]/g, "")}`).test(text)).length;
  return hit / words.length;
}

/** "onions" -> "onion", "tomatoes" -> "tomato", "chillies" -> "chilli". */
export function singular(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "i";
  if (w.endsWith("oes")) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Does the text name `word` as a whole word (plural allowed)? "onion" matches "Onion & Tomato Masala", not "Onionless". */
export function namesWord(text: string, word: string): boolean {
  const w = singular(word.toLowerCase().trim()).replace(/[^a-z0-9 ]/g, "");
  if (!w) return false;
  return new RegExp(`(^|[^a-z0-9])${w.replace(/ /g, "[ _-]")}(e?s)?($|[^a-z0-9])`).test(text.toLowerCase().replace(/_/g, " "));
}
