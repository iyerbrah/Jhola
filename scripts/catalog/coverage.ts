/**
 * Does the grocery catalogue cover what shoppers ask for? Two checks, both without model calls:
 *
 *  1. Kind depth: every kind gives a real choice. At least 3 products in stock and 2 brands (fresh produce
 *     and meat come from one shop brand, so they only need the 3); staples need 6 and 2 pack sizes.
 *  2. Requests: for each request in evals/coverage/requests.json, every slot has an in-stock product
 *     that fits the request's diet and rules, judged by the same code the solver uses.
 *
 * Used by scripts/catalog-coverage.ts (npm run catalog:coverage) and tests/catalogCoverage.test.ts.
 */
import { indexCatalog } from "../../lib/catalog";
import { review } from "../../lib/cart/review";
import { blockedBy, containsFor, solve } from "../../lib/cart/solve";
import type { Brief, Check, Need, Session } from "../../lib/cart/types";
import type { Diet } from "../../lib/requirements";
import { CONTAINS, LABELS, packLabel, type Contains, type Product } from "../../lib/schema";

/** Everyday kinds most carts use: these need more choice than the rest. */
export const STAPLES = [
  "milk", "curd", "paneer", "butter", "cheese", "ice_cream", "bread", "oats", "atta", "basmati_rice", "rice",
  "toor_dal", "moong_dal", "masoor_dal", "urad_dal", "chana_dal", "sugar", "cooking_oil", "ghee", "salt", "turmeric",
  "chilli_powder", "cumin", "ketchup", "chips", "namkeen", "biscuits", "noodles", "chocolate", "tea", "coffee",
  "soft_drink", "juice", "eggs", "chicken", "mutton", "onion", "potato", "tomato", "garlic", "ginger", "lemon",
  "banana", "apple", "detergent", "dishwash", "floor_cleaner", "toilet_cleaner", "soap", "shampoo", "toothpaste", "diapers",
] as const;
/** One shop brand sells most fresh food, so brand variety isn't asked of these. */
const SINGLE_BRAND_OK = new Set(["fruits_vegetables", "eggs_meat"]);

export type CoverageRequest = {
  group: string;
  request: string;
  kinds: string[];
  diet?: Diet;
  /** Words ruled out: what food contains (dairy, gluten, nuts...) or any other word ("onion"). */
  exclude?: string[];
  /** Standing preferences: organic, sugar_free, whole_grain, high_protein. */
  prefer?: string[];
};
export type DepthProblem = { kind: string; in_stock: number; brands: number; sizes: number; needs: string };
export type RequestResult = { request: CoverageRequest; missing: string[] };

export function kindDepth(products: Product[]): DepthProblem[] {
  const byKind = new Map<string, Product[]>();
  for (const p of products) byKind.set(p.sub_category, [...(byKind.get(p.sub_category) ?? []), p]);
  const staples = new Set<string>(STAPLES);
  const problems: DepthProblem[] = [];
  for (const [kind, all] of [...byKind].sort(([a], [b]) => a.localeCompare(b))) {
    const ps = all.filter((p) => p.in_stock);
    const brands = new Set(ps.map((p) => p.brand.toLowerCase())).size;
    const sizes = new Set(ps.map(packLabel)).size;
    const staple = staples.has(kind);
    const wantStock = staple ? 6 : 3;
    const wantBrands = SINGLE_BRAND_OK.has(all[0].category) ? 1 : 2;
    const wantSizes = staple ? 2 : 1;
    if (ps.length < wantStock || brands < wantBrands || sizes < wantSizes)
      problems.push({ kind, in_stock: ps.length, brands, sizes, needs: `${wantStock} in stock, ${wantBrands} brand${wantBrands > 1 ? "s" : ""}, ${wantSizes} size${wantSizes > 1 ? "s" : ""}` });
  }
  return problems;
}

/** Slot names that aren't kinds in the catalogue: a typo in requests.json, or a kind that was removed. */
export function unknownKinds(products: Product[], requests: CoverageRequest[]): string[] {
  const kinds = new Set(products.map((p) => p.sub_category));
  return [...new Set(requests.flatMap((r) => r.kinds.flatMap((slot) => slot.split("|"))).filter((k) => !kinds.has(k)))].sort();
}

/** The brief a shopper's request gives: diet, what to avoid (by contains), other rules and preferences. */
export function briefFor(request: CoverageRequest): Brief {
  const avoid = (request.exclude ?? []).map(containsFor).filter((c): c is Contains => c != null && (CONTAINS as readonly string[]).includes(c));
  const rules = (request.exclude ?? []).filter((w) => !containsFor(w)).map((value) => ({ kind: "exclude_word" as const, value, label: `No ${value}` }));
  const labels = (request.prefer ?? []).filter((l): l is (typeof LABELS)[number] => (LABELS as readonly string[]).includes(l));
  return { summary: request.request, people: 2, budget_inr: null, diet: request.diet ?? null, quality: "balanced", rules, avoid, prefer: { labels, brands: [] }, assumptions: [], plan: [] };
}

export function checkRequests(products: Product[], requests: CoverageRequest[]): RequestResult[] {
  return requests.map((request) => {
    const brief = briefFor(request);
    const fits = (p: Product) => p.in_stock && !blockedBy(p, brief);
    const ok = new Set(products.filter(fits).map((p) => p.sub_category));
    return { request, missing: request.kinds.filter((slot) => !slot.split("|").some((k) => ok.has(k))) };
  });
}

export type ReferenceResult = { request: CoverageRequest; problems: string[] };

/**
 * A reference cart for each request, with no model: the brief the request gives, and one need per slot
 * (the first kind that has a fitting product, about one usual pack of it). Solved and reviewed like any
 * cart. A problem is a failed check, an unmet need, a preference the store could have met but didn't,
 * or a line bought in a unit it can't be measured in.
 */
export function referenceCarts(products: Product[], requests: CoverageRequest[]): ReferenceResult[] {
  const ctx = { products, index: indexCatalog(products) };
  return requests.map((request) => {
    const brief = briefFor(request);
    const needs: Need[] = request.kinds.flatMap((slot, i) => {
      const kind = slot.split("|").find((k) => products.some((p) => p.sub_category === k && p.in_stock && !blockedBy(p, brief)));
      if (!kind) return [];
      const ps = products.filter((p) => p.sub_category === kind && p.in_stock);
      const units = new Map<string, number>();
      for (const p of ps) units.set(p.unit, (units.get(p.unit) ?? 0) + 1);
      const unit = [...units].sort((a, b) => b[1] - a[1])[0][0] as Need["unit"];
      const sizes = ps.filter((p) => p.unit === unit).map((p) => p.pack_size).sort((a, b) => a - b);
      return [{
        id: `n${i}`, group: "request", label: kind.replace(/_/g, " "), kind, amount: sizes[Math.floor(sizes.length / 2)], unit,
        per_person: false, role: "core", ticked: true, count: null, prefer: null, why: "", confidence: "sure",
      } as Need];
    });
    const session: Session = { brief, needs, pins: [], picks: {}, choices: {} };
    const cart = solve(session, ctx);
    const checks: Check[] = review(session, cart, ctx.index);
    const problems = [
      ...checks.filter((c) => c.status === "fail").map((c) => `✗ ${c.label}`),
      ...checks.filter((c) => c.id.startsWith("prefer:") && c.status !== "pass").map((c) => `⚠ ${c.label}`),
      ...cart.unmet.map((u) => `unmet ${u.label}: ${u.detail}`),
      ...cart.lines.flatMap((l) => l.warnings.filter((w) => w.startsWith("Sold ")).map((w) => `${l.label}: ${w}`)),
    ];
    return { request, problems };
  });
}

/** Share of requests whose every slot can be filled. */
export const coveredShare = (results: RequestResult[]) => results.filter((r) => r.missing.length === 0).length / Math.max(1, results.length);
