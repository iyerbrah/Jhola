/**
 * The solver: (brief, needs, pins, catalog) -> one cart. Pure, deterministic and fast (milliseconds).
 *
 * The agent decides what the shopper needs; this decides which products, how many packs and what it
 * costs. Every cart it returns is valid by construction:
 * - only in-stock products, and only ones that fit the diet and every rule (rules are hard filters,
 *   so "no onions" can't come back on a later turn);
 * - whole packs (1-10) that cover the amount needed;
 * - one line per product;
 * - within the budget when that's possible: an exact multiple-choice knapsack over rupees picks the
 *   best-fitting option for every need at once, dropping extras only if it must. Main and core needs
 *   and the shopper's pins are never dropped; if even their cheapest options don't fit, the cart says so
 *   (floor_inr) and the agent decides what to do.
 *
 * It also records how each line was picked (the options compared and the deciding rule), recovers from
 * stock-outs by taking the closest in-stock match (and says so), and keeps each need's previous product
 * when it is still a good fit, so an edit changes only what it has to.
 */
import unitHints from "@/data/unit-hints.json";
import type { CatalogIndex } from "../catalog";
import { fitsDiet } from "../requirements";
import { isFood, packLabel, type Contains, type Product } from "../schema";
import { isSameKind, matchesKind } from "../kind";
import { detectInjection } from "./safety";
import { namesWord, oddSize, plainness, preferScore, QUALITY_TARGET, qualityScore, typicality } from "./quality";
import {
  amountLabel,
  avoidOf,
  cartTotal,
  preferOf,
  toLineProduct,
  type Brief,
  type Cart,
  type Line,
  type Need,
  type Option,
  type Pin,
  type Rule,
  type Session,
  type UnmetReason,
} from "./types";

export type SolveContext = { products: Product[]; index: CatalogIndex };

export const MAX_PACKS = 10;
/** Per-person needs when the Brief has no head count. */
export const DEFAULT_PEOPLE = 2;
/** Options per need the budget search considers: the best fits plus the cheapest. */
const MAX_OPTIONS = 16;
const CHEAPEST_KEPT = 3;
/** Products shown in "How I picked this". */
const COMPARED = 4;
/** Budget search resolution: costs are counted in steps of at least ₹1, at most this many steps. */
const MAX_STEPS = 20_000;

// Utility weights. Fit to the quality target is worth up to 1; the rest are nudges around it.
const W_WASTE = 0.3;
/** How much paying more than the cheapest way to cover a need counts against an option, by quality setting. */
const W_COST: Record<Brief["quality"], number> = { value: 0.6, balanced: 0.3, premium: 0.1 };
const W_PREFER = 0.6;
const W_STAY = 0.3;
const W_TWIN = 0.5;
/** A product that looks like the rest of its kind (bread, not ladi pav) is the safe default. */
const W_TYPICAL = 0.5;
/** The need's own label ("Sandwich bread") counts as a soft preference. */
const W_LABEL = 0.6;
/** The plainly named product ("Onion", not "Sambar Onion - Peeled") is the default. */
const W_PLAIN = 0.6;
/** For things bought by the pack, a pack far from the kind's usual size (a 1.5 L refill) is less likely. */
const W_SIZE = 0.25;
/** A bigger pack than needed only matters when it costs real money: waste counts in full from this line cost. */
const WASTE_FULL_AT = 100;
/** Oversized-pack warnings only when the unused part is worth at least this much. */
const WARN_WASTE_INR = 50;
const W_PIN = 5;
/** The agent's choice among close options: stronger than keeping last time's pick, weaker than a pin. */
const W_CHOSEN = 1.5;
/** A standing preference from the brief (organic, a liked brand) the product meets: outweighs price, waste and naming, so it wins whenever the store has one (only pins and diet or rules come first). */
const W_BRIEF_PREFER = 2;
/** A pick counts as unsure when the runner-up is this close, or the product is unusual for its kind. */
const UNSURE_GAP = 0.15;
const UNSURE_TYPICAL = 0.5;
const UNSURE_PLAIN = 0.34;
/** Dropping an extra must always lose to keeping it when the budget allows. */
const DROP_EXTRA = -20;

type Choice = { p: Product; packs: number };
type Opt = { choices: Choice[]; cost: number; util: number };

type NeedPlan = {
  need: Need;
  /** The product the agent chose for this need, if any (it may since have been ruled out). */
  chosen: string | null;
  /** The amount after scaling by people, in the need's unit (packs for "pack"). */
  amount: number;
  pin: Pin | null;
  /** In-stock options, best first. */
  options: Opt[];
  /** What the need would get if stock didn't matter (for substitution notes). */
  wanted: Opt | null;
  /** Every candidate compared, in-stock or not, best first (for provenance). */
  ranked: { p: Product; packs: number; base: number; util: number }[];
  mandatory: boolean;
  /** Products the need had after the last solve. */
  previous: Set<string>;
  warnings: string[];
};

const g2ml = (u: string) => (u === "ml" ? "g" : u);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Rough grams per piece, by kind (data/unit-hints.json): a banana, a cabbage, a bunch of coriander. */
const GRAMS_PER_PIECE: Record<string, number> = Object.fromEntries(
  Object.entries(unitHints.grams_per_piece).filter((e): e is [string, number] => typeof e[1] === "number"),
);

/**
 * The need's amount in the product's own unit, or null when they can't be compared. g and ml count as
 * the same for groceries (oil, ghee, sauces are sold either way). Kinds sold both by the piece and by
 * weight convert through their weight per piece: "12 bananas" can be a 1 kg bag, "2 kg cabbage" is 3 heads.
 */
export function amountInUnit(needUnit: Need["unit"], amount: number, p: Pick<Product, "unit" | "sub_category" | "pack_size">): number | null {
  if (needUnit === "pack") return null;
  if (g2ml(needUnit) === g2ml(p.unit)) return amount;
  const perPiece = GRAMS_PER_PIECE[p.sub_category];
  if (needUnit === "pcs" && g2ml(p.unit) === "g") {
    // A counted thing sold by weight: fresh produce by its weight per piece; anything else (a soap bar,
    // a bottle of cola, a packet of salt) is one pack per piece.
    return amount * (perPiece ?? p.pack_size);
  }
  if (g2ml(needUnit) === "g" && p.unit === "pcs" && perPiece) return amount / perPiece;
  return null;
}

/** Can this product be bought by the need's amount (directly or through its weight per piece)? */
function compatible(needUnit: Need["unit"], p: Product): boolean {
  return needUnit === "pack" || amountInUnit(needUnit, 1, p) != null;
}

/** Labels a stand-in must keep: an organic pick is never replaced by a plain one without asking. */
const KEPT_LABELS = ["organic", "sugar_free", "whole_grain"];
/** Can `alt` stand in for `wanted` without losing what the shopper got: its labels, and no new allergen? */
export function keepsIntent(wanted: Product, alt: Product): boolean {
  if (!KEPT_LABELS.every((l) => !wanted.tags.includes(l) || alt.tags.includes(l))) return false;
  const had = new Set(wanted.contains ?? []);
  return (alt.contains ?? []).every((c) => had.has(c));
}

/** Does the product contain something the brief avoids? Returns the first one, for the label. */
export function avoidedBy(p: Product, brief: Brief): Contains | null {
  if (!isFood(p)) return null;
  return avoidOf(brief).find((c) => p.contains?.includes(c)) ?? null;
}

/** "No nuts", "No gluten": how an avoided ingredient reads to the shopper. */
export const avoidLabel = (c: Contains) => `No ${c}`;

/** How strongly a product meets the brief's standing preferences, 0..1. */
export function briefPreferScore(p: Product, brief: Brief): number {
  const { labels, brands } = preferOf(brief);
  const wants = labels.length + (brands.length ? 1 : 0);
  if (!wants) return 0;
  const got = labels.filter((l) => p.tags.includes(l)).length + (brands.some((b) => namesWord(p.brand, b)) ? 1 : 0);
  return got / wants;
}

/**
 * The name with its negated mentions taken out: "Chhole Masala With No Garlic & Onion" -> "Chhole Masala
 * With", "Gluten Free Oats" -> "Oats". A "no onions" rule must not throw out the onion-free masala.
 */
export function withoutNegations(name: string): string {
  return name
    .replace(/\b(no|without|zero|non)[\s-]+[a-z]+(\s*(&|and|,)\s*[a-z]+)*/gi, " ")
    .replace(/\b[a-z]+[\s-]free\b/gi, " ")
    .replace(/\b[a-z]+less\b/gi, " ");
}

/**
 * Rule words that name what a food contains ("no dairy", "nut allergy", "gluten free"), so the rule also
 * catches products that contain it without saying so in the name (butter cookies, cakes, chocolate).
 */
const CONTAINS_WORDS: Record<string, Contains> = {
  dairy: "dairy",
  "dairy product": "dairy",
  "milk product": "dairy",
  lactose: "dairy",
  egg: "egg",
  gluten: "gluten",
  wheat: "gluten",
  nut: "nuts",
  "tree nut": "nuts",
  peanut: "peanut",
  groundnut: "peanut",
  soy: "soy",
  soya: "soy",
};

/** The `contains` value a rule word names, if any ("eggs" -> egg, "nuts" -> nuts). */
export function containsFor(word: string): Contains | null {
  const w = word.toLowerCase().trim().replace(/[\s_-]+/g, " ");
  return CONTAINS_WORDS[w] ?? CONTAINS_WORDS[w.replace(/s$/, "")] ?? null;
}

/**
 * Does the rule exclude this product?
 * - A rule naming what food contains ("no dairy", "nut allergy", "gluten free") is decided by the
 *   catalogue's `contains` column alone: butter cookies count as dairy, and "Gluten Free" oats, tofu and
 *   soy milk stay in.
 * - Other words match the product's name and kind as whole words, never its tags ("no sugar" keeps
 *   sugar-free products) and never a negated mention ("no onions" keeps "Masala With No Garlic & Onion").
 */
export function excludedBy(p: Product, rule: Rule): boolean {
  const contained = rule.kind === "exclude_kind" || rule.kind === "exclude_word" ? containsFor(rule.value) : null;
  if (contained) return isFood(p) && (p.contains?.includes(contained) ?? false);
  const text = `${withoutNegations(p.name)} ${p.sub_category}`;
  switch (rule.kind) {
    case "exclude_kind": {
      const value = rule.value.replace(/[\s-]+/g, "_");
      return p.sub_category === value || p.category === value || namesWord(text, rule.value);
    }
    case "exclude_word":
      return namesWord(text, rule.value);
    case "exclude_brand":
      return p.brand.toLowerCase() === rule.value || namesWord(p.brand, rule.value);
    case "have":
      return false;
  }
}

/** Does a "have" rule cover this need ("have rice" covers a basmati rice need)? */
export function coveredByHave(need: Need, rule: Rule): boolean {
  if (rule.kind !== "have") return false;
  return need.kind === rule.value.replace(/[\s-]+/g, "_") || namesWord(`${need.label} ${need.kind}`, rule.value);
}

/** Why a product can't go in this cart, or null if it can. */
export function blockedBy(p: Product, brief: Brief): string | null {
  if (brief.diet && !fitsDiet(p, brief.diet)) return "diet";
  const avoided = avoidedBy(p, brief);
  if (avoided) return avoidLabel(avoided);
  const rule = brief.rules.find((r) => excludedBy(p, r));
  return rule ? rule.label : null;
}

function peopleFor(brief: Brief): number {
  return brief.people ?? DEFAULT_PEOPLE;
}

/** Packs of p that cover `amount` (in the need's unit), or null if it takes more than MAX_PACKS. */
function packsFor(need: Need, amount: number, p: Product): number | null {
  const inUnit = amountInUnit(need.unit, amount, p);
  if (inUnit == null) return Math.min(MAX_PACKS, Math.max(1, Math.round(need.unit === "pack" ? amount : 1)));
  const n = Math.max(1, Math.ceil(inUnit / p.pack_size - 0.05));
  return n <= MAX_PACKS ? n : null;
}

function unitPrice(p: Product): string {
  const per = p.unit === "pcs" ? 1 : 100;
  const value = (p.price / p.pack_size) * per;
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `₹${rounded} per ${p.unit === "pcs" ? "piece" : `100 ${p.unit}`}`;
}

/** Candidates for a need: its kind's products (or the closest by name), before diet, rule and stock filters. */
function kindProducts(need: Need, products: Product[]): Product[] {
  const exact = products.filter((p) => p.sub_category === need.kind);
  if (exact.length) return exact;
  return products.filter((p) => matchesKind(p, need.kind));
}

type Blocked = { unmet: UnmetReason; detail: string } | { skip: string };

function plan(need: Need, brief: Brief, pins: Map<string, Pin>, picks: Record<string, string>, choices: Record<string, string>, ctx: SolveContext): NeedPlan | Blocked {
  const amount = need.amount * (need.per_person ? peopleFor(brief) : 1);
  const pin = pins.get(need.id) ?? null;
  const warnings: string[] = [];
  const target = QUALITY_TARGET[brief.quality];
  // Products this need had last time (a count need has several: "id", "id#2", ...).
  const previous = new Set(Object.entries(picks).filter(([k]) => k === need.id || k.startsWith(`${need.id}#`)).map(([, v]) => v));

  let pool: Product[];
  if (pin) {
    const p = ctx.index.get(pin.product_id);
    if (!p) return { unmet: "unknown_kind", detail: `your pick ${pin.product_id} isn't in the catalog` };
    const blocked = blockedBy(p, brief);
    if (blocked) return { unmet: "pin_breaks_rule", detail: `your pick ${p.name} breaks "${blocked === "diet" ? brief.diet : blocked}"` };
    // A pinned product that went out of stock falls back to its closest twins, and says so.
    pool = p.in_stock ? [p] : [p, ...ctx.products.filter((x) => x.in_stock && x.id !== p.id && isSameKind(p, x) && keepsIntent(p, x) && !blockedBy(x, brief))];
  } else {
    const all = kindProducts(need, ctx.products);
    if (!all.length) return { unmet: "unknown_kind", detail: `the store has nothing that counts as ${need.kind.replace(/_/g, " ")}` };
    const fitDiet = all.filter((p) => !brief.diet || fitsDiet(p, brief.diet));
    if (!fitDiet.length) return { unmet: "none_fit_diet", detail: `nothing ${need.label.toLowerCase()} fits ${brief.diet}` };
    const noAvoided = fitDiet.filter((p) => !avoidedBy(p, brief));
    if (!noAvoided.length) return { skip: avoidLabel(avoidedBy(fitDiet[0], brief)!) };
    pool = noAvoided.filter((p) => !brief.rules.some((r) => excludedBy(p, r)));
    if (!pool.length) {
      // The shopper's rule left this need out ("no onions" and an onion need): that's the rule working,
      // not a failure. Name the rule that rules out the most of the kind.
      const rule = [...brief.rules].sort((a, b) => noAvoided.filter((p) => excludedBy(p, b)).length - noAvoided.filter((p) => excludedBy(p, a)).length)[0];
      return { skip: rule.label };
    }
    // Preference words narrow the kind first ("fresh cream" within cream, "organic" within bananas), across
    // every unit the kind is sold in: an organic banana sold by the piece still counts for a need in grams.
    // Keep the products that match best among those in stock (and sold-out ones as good, for stand-ins).
    // If nothing in stock matches, the preference stays a nudge rather than leaving the need unfilled.
    if (need.prefer) {
      // Products matching at least half as well stay in the running (the scoring still favours the best
      // match), so "salted butter" can't force a 500 g pack when a 100 g butter would do.
      const best = Math.max(0, ...pool.filter((p) => p.in_stock).map((p) => preferScore(p, need.prefer)));
      if (best > 0) pool = pool.filter((p) => preferScore(p, need.prefer) >= best / 2);
      else if (pool.some((p) => preferScore(p, need.prefer) > 0)) warnings.push(`No "${need.prefer}" in stock, so this is the closest`);
    }
    // Then products that can be bought by the need's amount (same unit, or converted by weight per piece),
    // when any are in stock. Sold-out ones alone don't count: "2 pcs of soap" must not come back empty because
    // the only soaps sold by the piece are sold out, when bars sold by weight are in stock.
    const sameUnit = pool.filter((p) => compatible(need.unit, p));
    if (sameUnit.some((p) => p.in_stock)) pool = sameUnit;
    else if (need.unit !== "pack") {
      const sold = pool[0].unit === "pcs" ? "by the piece" : `by ${pool[0].unit === "ml" ? "volume" : "weight"}`;
      warnings.push(`Sold ${sold} (${packLabel(pool[0])}), not by ${need.unit}: bought 1 pack, check the amount`);
    }
  }

  // The cheapest way to cover the need, as the yardstick for how much more an option costs.
  const covering = pool.flatMap((p) => {
    const n = pin?.qty != null && p.id === pin.product_id ? pin.qty : packsFor(need, amount, p);
    return n == null ? [] : [p.price * n];
  });
  const minCost = Math.max(1, Math.min(...covering, Infinity));
  const util = (p: Product, packs: number) => {
    // Quality decides among products of the same thing. A special variant's price per gram (peeled
    // sambar onions, a pink salt grinder) says less about quality, so its fit counts for less.
    const plain = plainness(p, `${need.label} ${need.prefer ?? ""}`);
    const fit = (1 - Math.abs(qualityScore(p, ctx.products) - target)) * (0.5 + 0.5 * plain);
    const bought = packs * p.pack_size;
    // Buying 16× what's needed is worse than 2×, but not without limit, and a ₹26 kilo of onions is no waste.
    const inUnit = amountInUnit(need.unit, amount, p);
    const byAmount = inUnit != null;
    const waste = inUnit != null ? Math.min(5, Math.log2(Math.max(1, bought / inUnit))) * Math.min(1, (p.price * packs) / WASTE_FULL_AT) : 0;
    // Bought by the pack: the usual size of the kind is the safe default.
    const odd = byAmount ? 0 : oddSize(p, ctx.products);
    const pricier = Math.min(1, (p.price * packs) / minCost - 1);
    // A pin outranks everything: it's the shopper's choice (its twins only stand in when it's out of stock).
    const pinned = pin && p.id === pin.product_id ? W_PIN : 0;
    // The agent's choice among close options. Only a weight: rules, diet and stock still filter first.
    const chosen = !pin && choices[need.id] === p.id ? W_CHOSEN : 0;
    return (
      fit -
      W_WASTE * waste -
      W_COST[brief.quality] * pricier +
      W_PREFER * preferScore(p, need.prefer) +
      W_LABEL * preferScore(p, need.label) +
      W_BRIEF_PREFER * briefPreferScore(p, brief) +
      W_TYPICAL * typicality(p, ctx.products) +
      W_PLAIN * plain -
      W_SIZE * odd +
      pinned +
      chosen
    );
  };

  // `base` is how well a product fits, from the need and the brief alone. The product the need would get
  // if stock didn't matter is decided on `base`, so the hint about last time's picks can't change it.
  const ranked: { p: Product; packs: number; base: number; util: number }[] = [];
  const add = (p: Product, packs: number) => {
    const base = util(p, packs);
    ranked.push({ p, packs, base, util: base + (previous.has(p.id) ? W_STAY : 0) });
  };
  for (const p of pool) {
    const packs = pin?.qty != null && p.id === pin.product_id ? pin.qty : packsFor(need, amount, p);
    if (packs != null) add(p, packs);
  }
  if (!ranked.length) {
    // Every pack is too small to cover the amount in 10 packs: take the biggest packs, 10 of them.
    const biggest = [...pool].sort((a, b) => b.pack_size - a.pack_size || a.price - b.price)[0];
    add(biggest, MAX_PACKS);
    warnings.push(`Needs more than ${MAX_PACKS} packs; capped at ${MAX_PACKS}`);
  }
  const byUtil = (a: { util: number; p: Product }, b: { util: number; p: Product }) => b.util - a.util || a.p.price - b.p.price || a.p.id.localeCompare(b.p.id);
  ranked.sort(byUtil);

  const best = [...ranked].sort((a, b) => b.base - a.base || a.p.price - b.p.price || a.p.id.localeCompare(b.p.id))[0];
  const wanted: Opt = { choices: [{ p: best.p, packs: best.packs }], cost: best.p.price * best.packs, util: best.base };
  // If the best product is out of stock, in-stock products closest to it get a bonus: the substitute is its twin.
  // (Not for "N different products": there's no one product to stand in for.)
  const twinBonus = (p: Product) => {
    if (best.p.in_stock || need.count) return 0;
    if (!isSameKind(best.p, p)) return 0;
    const size = Math.abs(Math.log(p.pack_size / best.p.pack_size));
    return W_TWIN * Math.max(0, 1 - size) + W_TWIN * Math.max(0, 1 - Math.abs(p.price - best.p.price) / best.p.price);
  };
  // A stand-in for a sold-out pick must be as close as the pick was: its twin (same kind, unit and form),
  // or a product that matches the need at least as well. Fresh cream never becomes a cream biscuit:
  // when nothing that close is in stock, the honest answer is that it's out of stock.
  // It also keeps what the pick gave the shopper: an organic pick stays organic, and no new allergen comes in.
  const closeEnough = (p: Product) =>
    best.p.in_stock ||
    need.count != null ||
    (keepsIntent(best.p, p) &&
      (isSameKind(best.p, p) ||
        (preferScore(p, need.prefer) >= preferScore(best.p, need.prefer) &&
          preferScore(p, need.label) >= preferScore(best.p, need.label) &&
          typicality(p, ctx.products) >= typicality(best.p, ctx.products) - 0.2)));
  const inStock = ranked
    .filter((r) => r.p.in_stock && closeEnough(r.p))
    .map((r) => ({ ...r, util: r.util + twinBonus(r.p) }))
    .sort(byUtil);
  if (!inStock.length) {
    return best.p.in_stock || !ranked.some((r) => r.p.in_stock)
      ? { unmet: "out_of_stock", detail: `every ${need.label.toLowerCase()} that fits is out of stock` }
      : { unmet: "out_of_stock", detail: `${best.p.brand} ${best.p.name} is out of stock, and nothing close enough is in stock` };
  }

  let options: Opt[];
  if (need.count) {
    // N different products: each combination of the top candidates is one option.
    const top = inStock.slice(0, 8);
    if (top.length < need.count) warnings.push(`Only ${top.length} different ${need.label.toLowerCase()} in stock`);
    options = combinations(top, Math.min(need.count, top.length)).map((combo) => ({
      // In catalog order, so the lines don't reorder when a re-solve ranks them differently.
      choices: combo.map((r) => ({ p: r.p, packs: r.packs })).sort((a, b) => a.p.id.localeCompare(b.p.id)),
      cost: combo.reduce((s, r) => s + r.p.price * r.packs, 0),
      util: combo.reduce((s, r) => s + r.util, 0),
    }));
  } else {
    const opt = (r: (typeof inStock)[number]): Opt => ({ choices: [{ p: r.p, packs: r.packs }], cost: r.p.price * r.packs, util: r.util });
    const cheapest = [...inStock].sort((a, b) => a.p.price * a.packs - b.p.price * b.packs || a.p.id.localeCompare(b.p.id)).slice(0, CHEAPEST_KEPT);
    const kept = new Set([...inStock.slice(0, MAX_OPTIONS - CHEAPEST_KEPT), ...cheapest]);
    options = inStock.filter((r) => kept.has(r)).map(opt);
  }
  options.sort((a, b) => b.util - a.util || a.cost - b.cost);

  return {
    need,
    chosen: pin ? null : (choices[need.id] ?? null),
    amount,
    pin,
    options,
    wanted: need.count ? null : wanted,
    ranked,
    mandatory: need.role !== "extra" || pin != null,
    previous,
    warnings,
  };
}

function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) return void out.push(acc);
    for (let i = start; i < items.length; i++) pick(i + 1, [...acc, items[i]]);
  };
  pick(0, []);
  return out;
}

/**
 * Picks one option per need (or drops an extra) for the most total utility within the budget:
 * a multiple-choice knapsack, solved exactly by dynamic programming over rupees.
 * Returns the chosen option index per need (-1 = dropped), or null if even the cheapest mandatory options don't fit.
 */
export function knapsack(plans: { options: { cost: number; util: number }[]; mandatory: boolean }[], budget: number): number[] | null {
  const step = Math.max(1, Math.ceil(budget / MAX_STEPS));
  const W = Math.floor(budget / step);
  // Costs round up, so a solution that fits in steps fits in rupees.
  const w = (cost: number) => Math.ceil(cost / step);
  let dp = new Float64Array(W + 1).fill(-Infinity);
  dp[0] = 0;
  const choice: Int16Array[] = [];
  for (const pl of plans) {
    const next = new Float64Array(W + 1).fill(-Infinity);
    const ch = new Int16Array(W + 1).fill(-2);
    for (let b = 0; b <= W; b++) {
      const base = dp[b];
      if (base === -Infinity) continue;
      if (!pl.mandatory && base + DROP_EXTRA > next[b]) {
        next[b] = base + DROP_EXTRA;
        ch[b] = -1;
      }
      for (let k = 0; k < pl.options.length; k++) {
        const nb = b + w(pl.options[k].cost);
        if (nb > W) continue;
        const v = base + pl.options[k].util;
        if (v > next[nb]) {
          next[nb] = v;
          ch[nb] = k;
        }
      }
    }
    choice.push(ch);
    dp = next;
  }
  let bestB = -1;
  for (let b = 0; b <= W; b++) if (dp[b] > -Infinity && (bestB < 0 || dp[b] > dp[bestB] + 1e-9)) bestB = b;
  if (bestB < 0) return null;
  const picks: number[] = new Array(plans.length);
  let b = bestB;
  for (let i = plans.length - 1; i >= 0; i--) {
    const k = choice[i][b];
    picks[i] = k;
    if (k >= 0) b -= w(plans[i].options[k].cost);
  }
  return picks;
}

function cheapestIndex(pl: NeedPlan): number {
  let best = 0;
  pl.options.forEach((o, k) => {
    if (o.cost < pl.options[best].cost || (o.cost === pl.options[best].cost && o.util > pl.options[best].util)) best = k;
  });
  return best;
}

function toOption(p: Product, packs: number, ctx: SolveContext): Option {
  return {
    product_id: p.id,
    name: p.name,
    brand: p.brand,
    pack_label: packLabel(p),
    price: p.price,
    packs,
    line_total: p.price * packs,
    unit_price: unitPrice(p),
    quality: Math.round(qualityScore(p, ctx.products) * 100) / 100,
    in_stock: p.in_stock,
  };
}

const QUALITY_RULE: Record<Brief["quality"], string> = {
  value: "Best value for the amount",
  balanced: "Mid-priced, a good fit for the amount",
  premium: "Top quality for the amount",
};

export function solve(session: Session, ctx: SolveContext): Cart {
  const { brief, needs } = session;
  const pins = new Map(session.pins.map((p) => [p.need_id, p]));
  const unmet: Cart["unmet"] = [];
  const skipped: Cart["skipped"] = [];
  const counted: NeedPlan[] = [];
  const uncounted: NeedPlan[] = [];

  for (const need of needs) {
    const have = brief.rules.find((r) => coveredByHave(need, r));
    if (have) {
      skipped.push({ need_id: need.id, label: need.label, rule: have.label, reason: "have" });
      continue;
    }
    const pl = plan(need, brief, pins, session.picks ?? {}, session.choices ?? {}, ctx);
    if ("skip" in pl) {
      skipped.push({ need_id: need.id, label: need.label, rule: pl.skip, reason: "rule" });
      continue;
    }
    if ("unmet" in pl) {
      unmet.push({ need_id: need.id, label: need.label, reason: pl.unmet, detail: pl.detail });
      continue;
    }
    (need.ticked ? counted : uncounted).push(pl);
  }

  // Choose options: the best fit for each need, unless a budget makes it a joint choice.
  const budget = brief.budget_inr;
  const unconstrained = counted.map(() => 0);
  let chosen = unconstrained;
  let overBudget = false;
  const floor = counted.filter((pl) => pl.mandatory).reduce((s, pl) => s + pl.options[cheapestIndex(pl)].cost, 0);
  if (budget != null) {
    const bestTotal = counted.reduce((s, pl) => s + pl.options[0].cost, 0);
    if (bestTotal > budget) {
      const fit = knapsack(counted, budget);
      if (fit) chosen = fit;
      else {
        // No exact fit: keep every main and core need at its cheapest and leave out the extras. That's
        // within budget if the floor is (rounding in the search can miss a fit that close); else say so.
        chosen = counted.map((pl) => (pl.mandatory ? cheapestIndex(pl) : -1));
        overBudget = floor > budget;
      }
    }
  }

  const dropped: Cart["dropped"] = [];
  const lines: Line[] = [];
  const build = (pl: NeedPlan, k: number, isCounted: boolean) => {
    const opt = pl.options[k];
    const inStockRanked = pl.ranked.filter((r) => r.p.in_stock);
    for (const c of opt.choices) {
      const compared = [c, ...inStockRanked.filter((r) => r.p.id !== c.p.id)].slice(0, COMPARED).map((r) => toOption(r.p, r.packs, ctx));
      const wanted = pl.wanted?.choices[0];
      const substitution =
        wanted && !wanted.p.in_stock && wanted.p.id !== c.p.id && !pl.previous.has(c.p.id)
          ? {
              wanted: { id: wanted.p.id, name: wanted.p.name, brand: wanted.p.brand, pack_label: packLabel(wanted.p), price: wanted.p.price },
              reason: "out_of_stock" as const,
              delta_inr: c.p.price * c.packs - wanted.p.price * wanted.packs,
            }
          : null;
      const budgetBound = budget != null && k !== 0 && !overBudget;
      const isChosen = pl.chosen === c.p.id;
      const rule = pl.pin && c.p.id === pl.pin.product_id
        ? "Your pick"
        : isChosen && !budgetBound
          ? "Chosen from close options for this request"
          : substitution
          ? `Closest in-stock match to ${wanted!.p.brand} ${wanted!.p.name}`
          : budgetBound
            ? `The best option that keeps the cart within ₹${budget}`
            : overBudget && pl.mandatory
              ? "The cheapest option (the cart can't fit the budget)"
              : pl.previous.has(c.p.id)
                ? "Kept from your cart: still the best fit"
                : pl.need.prefer && preferScore(c.p, pl.need.prefer) > 0
                  ? `Matches "${pl.need.prefer}"; ${QUALITY_RULE[brief.quality].toLowerCase()}`
                  : QUALITY_RULE[brief.quality];
      const warnings = [...pl.warnings];
      const needed = amountInUnit(pl.need.unit, pl.amount, c.p);
      if (needed != null) {
        const bought = c.packs * c.p.pack_size;
        // A pack much bigger than the need, when no smaller pack in stock would do: say so.
        const smaller = inStockRanked.some((r) => {
          const n = amountInUnit(pl.need.unit, pl.amount, r.p);
          return n != null && (r.packs * r.p.pack_size) / n < bought / needed;
        });
        // Only for counted lines, and only when the unused part is worth something.
        const unusedInr = Math.round((c.p.price * c.packs * (bought - needed)) / bought);
        if (isCounted && !smaller && bought >= needed * 3 && unusedInr >= WARN_WASTE_INR) {
          warnings.push(`${cap(pl.need.label)} only comes in ${packLabel(c.p)}; you need about ${amountLabel(pl.amount, pl.need.unit as "g")}`);
        }
      }
      // Unsure: the runner-up is close, or the pick is an unusual product for its kind. Only for one-product
      // needs the shopper and the agent haven't decided, and only with an in-stock alternative to pick.
      const uncertain =
        !pl.pin &&
        !pl.chosen &&
        !pl.need.count &&
        pl.options.length > 1 &&
        (pl.options[0].util - pl.options[1].util < UNSURE_GAP ||
          typicality(c.p, ctx.products) < UNSURE_TYPICAL ||
          plainness(c.p, `${pl.need.label} ${pl.need.prefer ?? ""}`) < UNSURE_PLAIN);
      lines.push({
        need_id: pl.need.id,
        also_for: [],
        group: pl.need.group,
        label: pl.need.label,
        why: pl.need.why,
        role: pl.need.role,
        counted: isCounted,
        pinned: pl.pin != null && c.p.id === pl.pin.product_id,
        product: toLineProduct(c.p, packLabel(c.p)),
        packs: c.packs,
        line_total: c.p.price * c.packs,
        needed: pl.need.unit === "pack" ? null : { amount: pl.amount, unit: pl.need.unit },
        per_person: pl.need.per_person,
        picked: { kind: c.p.sub_category, compared, rule },
        substitution,
        warnings,
        flagged: [c.p.name, c.p.brand, c.p.description ?? ""].some((t) => detectInjection(t).suspicious),
        uncertain,
      });
    }
  };
  counted.forEach((pl, i) => {
    const k = chosen[i];
    if (k < 0) dropped.push({ need_id: pl.need.id, label: pl.need.label, saving_inr: pl.options[0].cost });
    else build(pl, k, true);
  });
  for (const pl of uncounted) build(pl, 0, false);

  return finalize(mergeDuplicates(lines), { budget_inr: budget, unmet, dropped, skipped, floor_inr: floor });
}

function finalize(lines: Line[], rest: Omit<Cart, "lines" | "total">): Cart {
  return { lines, total: cartTotal(lines), ...rest };
}

/**
 * Two needs that picked the same product share one line: packs come from the combined amount
 * (never more than the two lines had), so the total can only go down.
 */
function mergeDuplicates(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (const l of lines) {
    const same = out.find((o) => o.product.id === l.product.id);
    if (!same) {
      out.push({ ...l, also_for: [...l.also_for] });
      continue;
    }
    same.also_for.push(l.need_id);
    if (same.counted !== l.counted) {
      // An unticked suggestion that's already in the cart as a counted line: the counted line covers it.
      if (!same.counted) Object.assign(same, { ...l, also_for: [...same.also_for.filter((id) => id !== l.need_id), same.need_id] });
      continue;
    }
    const wanted = same.packs + l.packs;
    if (same.needed && l.needed && same.needed.unit === l.needed.unit) {
      same.needed = { amount: same.needed.amount + l.needed.amount, unit: same.needed.unit };
      const inUnit = amountInUnit(same.needed.unit, same.needed.amount, same.product);
      const covering = inUnit == null ? wanted : Math.max(1, Math.ceil(inUnit / same.product.pack_size - 0.05));
      same.packs = Math.min(MAX_PACKS, wanted, covering);
      if (covering > MAX_PACKS) same.warnings = [...new Set([...same.warnings, `Needs more than ${MAX_PACKS} packs; capped at ${MAX_PACKS}`])];
    } else {
      same.packs = Math.min(MAX_PACKS, wanted);
    }
    same.line_total = same.product.price * same.packs;
    same.pinned = same.pinned || l.pinned;
  }
  return out;
}

/** need id -> product id, for the next solve's "keep what still fits" hint. */
export function picksOf(cart: Cart): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (needId: string, productId: string) => {
    let key = needId;
    for (let k = 2; out[key] != null; k++) key = `${needId}#${k}`;
    out[key] = productId;
  };
  for (const l of cart.lines) {
    put(l.need_id, l.product.id);
    for (const id of l.also_for) put(id, l.product.id);
  }
  return out;
}
