/**
 * How "premium" a product is within its kind, from catalog data alone (the catalog has no ratings):
 * where its price per gram, ml or piece falls among the other products of its kind, nudged by
 * name and brand words that mark a premium or a budget line.
 */
import type { Contains, Product } from "../schema";
import type { Quality } from "./types";

/** Where each quality setting aims, as a quality score (0 = cheapest per unit, 1 = priciest). */
export const QUALITY_TARGET: Record<Quality, number> = { value: 0.15, balanced: 0.5, premium: 0.9 };

const PREMIUM_WORDS = /\b(premium|organic|gold|signature|luxury|select|royal|extra virgin|cold pressed|artisan|imported)\b/i;
const BUDGET_WORDS = /\b(super saver|economy|value pack|popular|bachat)\b/i;
const WORD_NUDGE = 0.15;

const cache = new WeakMap<Product[], Map<string, number>>();

/** Packs within this factor of each other count as the same size class when comparing prices. */
const SIZE_CLASS = 2.5;
/** Fewest products a size class needs before it's used; smaller classes fall back to the whole kind. */
const MIN_CLASS = 3;

/** Where `p`'s price per unit falls among `peers` (which include it), 0..1. Equal prices score the same. */
function percentile(p: Product, peers: Product[]): number {
  if (peers.length <= 1) return 0.5;
  const unit = (x: Product) => x.price / x.pack_size;
  const sorted = [...peers].sort((a, b) => unit(a) - unit(b) || a.id.localeCompare(b.id));
  // Products at the same price per unit (a 1 kg and a 2 kg bag of the same onions) score the same.
  const first = sorted.findIndex((x) => Math.abs(unit(x) - unit(p)) < 1e-9);
  const last = sorted.length - 1 - [...sorted].reverse().findIndex((x) => Math.abs(unit(x) - unit(p)) < 1e-9);
  return (first + last) / 2 / (sorted.length - 1);
}

/**
 * Price per unit percentile within the kind, 0..1. A kind with one product scores 0.5.
 *
 * A product is compared with products of a similar pack size (same unit, within 2.5x), because big packs
 * cost less per unit: compared with the whole kind, a 250 ml cola would look "premium" next to a 2.25 L
 * bottle of the same cola, and a balanced cart would buy eight small bottles. Within a size class, the
 * score says what it should: how premium the product is. A class with fewer than 3 products falls back to
 * the kind's products in the same unit; prices per piece and per gram are never compared, so a product
 * with fewer than 3 others in its unit scores a neutral 0.5.
 */
function percentiles(products: Product[]): Map<string, number> {
  const byKind = new Map<string, Product[]>();
  for (const p of products) byKind.set(p.sub_category, [...(byKind.get(p.sub_category) ?? []), p]);
  const out = new Map<string, number>();
  for (const ps of byKind.values()) {
    for (const p of ps) {
      const sameUnit = ps.filter((x) => x.unit === p.unit);
      const sameSize = sameUnit.filter((x) => x.pack_size <= p.pack_size * SIZE_CLASS && x.pack_size * SIZE_CLASS >= p.pack_size);
      if (sameSize.length >= MIN_CLASS) out.set(p.id, percentile(p, sameSize));
      else if (sameUnit.length >= MIN_CLASS) out.set(p.id, percentile(p, sameUnit));
      else out.set(p.id, sameUnit.length === ps.length ? percentile(p, ps) : 0.5);
    }
  }
  return out;
}

/** The product's quality score within its kind, 0..1. */
export function qualityScore(p: Product, products: Product[]): number {
  let map = cache.get(products);
  if (!map) cache.set(products, (map = percentiles(products)));
  // Words in the product's own name, not its brand: "BB Royal" is a house staples brand, not a premium line.
  // Organic counts as premium, said in the name or not.
  const premium = PREMIUM_WORDS.test(p.name) || p.tags.includes("organic");
  const budget = BUDGET_WORDS.test(p.name) || BUDGET_WORDS.test(p.brand);
  const nudge = (premium ? WORD_NUDGE : 0) - (budget ? WORD_NUDGE : 0);
  return Math.min(1, Math.max(0, (map.get(p.id) ?? 0.5) + nudge));
}

const NAME_STOP = new Set(["and", "with", "the", "for", "pack", "pcs", "of", "in", "a", "fresh", "premium", "organic", "classic", "original", "new", "pure", "natural"]);
const nameWords = (p: Product) => new Set((p.name.toLowerCase().match(/[a-z]{3,}/g) ?? []).map(singular).filter((w) => !NAME_STOP.has(w)));
const typicalCache = new WeakMap<Product[], Map<string, number>>();
/** A product named with its kind's own words is at least this typical. */
const TYPICAL_BY_KIND_WORD = 0.75;

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
      // The kind's own words and its shopper words are typical too: in an umbrella kind (pulses, biscuits,
      // soft drinks) names share little, but "Toor Dal" in pulses or "Cola" in soft drinks is no oddity.
      const kindWords = new Set(
        [ps[0].sub_category.replace(/_/g, " "), ...(ps[0].search_terms ?? [])].flatMap((t) => (t.toLowerCase().match(/[a-z]{3,}/g) ?? []).map(singular)),
      );
      for (const x of ps) {
        const best = Math.max(0, ...[...nameWords(x)].map((w) => df.get(w) ?? 0));
        const shared = names.length <= 1 ? 1 : (best - 1) / (names.length - 1);
        map.set(x.id, [...nameWords(x)].some((w) => kindWords.has(w)) ? Math.max(shared, TYPICAL_BY_KIND_WORD) : shared);
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

/** Free-from words in a preference ("dairy free", "no egg", "eggless") and what they mean in `contains`. */
const FREE_FROM: [RegExp, Contains][] = [
  [/\b(dairy|milk|lactose)[\s-]*free\b|\bno (dairy|milk)\b|\bnon[\s-]?dairy\b/g, "dairy"],
  [/\begg[\s-]*free\b|\beggless\b|\bno eggs?\b/g, "egg"],
  [/\bgluten[\s-]*free\b|\bno gluten\b/g, "gluten"],
  [/\bnut[\s-]*free\b|\bno nuts?\b/g, "nuts"],
  [/\bpeanut[\s-]*free\b|\bno peanuts?\b/g, "peanut"],
  [/\bsoy[\s-]*free\b|\bno soy\b/g, "soy"],
];
const PREFER_STOP = new Set(["no", "the", "and", "with", "of", "for", "a", "an"]);

/**
 * How well a product matches a need's preference words (0..1): the share of the words found as whole
 * words in its name, brand, kind or tags. Free-from words count by what it contains:
 * "dairy free" matches a product without dairy, not one with "dairy" in its name.
 */
export function preferScore(p: Product, prefer: string | null): number {
  if (!prefer) return 0;
  let rest = prefer.toLowerCase();
  const freeFrom: Contains[] = [];
  for (const [re, c] of FREE_FROM) {
    if (re.test(rest)) freeFrom.push(c);
    re.lastIndex = 0;
    rest = rest.replace(re, " ");
  }
  const words = rest.match(/[a-z0-9%]+/g)?.filter((w) => w.length > 1 && !PREFER_STOP.has(w)) ?? [];
  if (!words.length && !freeFrom.length) return 0;
  // Not the shopper words: they belong to the whole kind ("nutella" is a word for every choco spread), so
  // they would make a named brand match every product of the kind.
  const text = `${p.name} ${p.brand} ${p.sub_category.replace(/_/g, " ")} ${p.tags.join(" ").replace(/_/g, " ")}`.toLowerCase();
  const hit = words.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9%]/g, "")}(e?s|ally|ly)?($|[^a-z0-9])`).test(text)).length;
  const free = freeFrom.filter((c) => !(p.contains ?? []).includes(c)).length;
  return (hit + free) / (words.length + freeFrom.length);
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
