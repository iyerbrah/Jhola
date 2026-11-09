/**
 * The second step of the two-step catalog lookup: which products each cart call gets to see.
 *
 * The plan call sees only the KINDS index (one line per kind of product, see kindIndex in lib/prompt.ts)
 * and names the kinds each cart needs. Code then adds:
 *  - the kinds of the named ingredients every cart must contain, and of a counted item kind;
 *  - as a safety net, the kind of the best search match for each shopping-list line, in case the plan
 *    left one out.
 * The cart call sees up to PER_KIND in-stock products of each kind, spread from cheapest to priciest
 * per gram, ml or piece, so a budget cart and a premium cart both have something to pick.
 */
import { createMemorySearch, type CatalogSearch } from "./agent/search";
import type { Plan, PlanVariant, Product } from "./schema";
import { matchesKind } from "./validate";

export const PER_KIND = 16;
export const MAX_KINDS = 24;

const searches = new WeakMap<Product[], CatalogSearch>();
const searchFor = (products: Product[]) => {
  let s = searches.get(products);
  if (!s) searches.set(products, (s = createMemorySearch(products)));
  return s;
};

/** "fresh cream 200 ml (optional)" -> "fresh cream" */
const lineText = (line: string) =>
  line
    .replace(/\(optional\)/gi, " ")
    .replace(/\d+(\.\d+)?\s*(g|gm|kg|ml|l|ltr|pcs?|pieces?)?\b/gi, " ")
    .trim();

/** Up to n products, evenly spaced through the list (which is sorted by unit price): the cheapest and the priciest always. */
function spread<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * (list.length - 1)) / (n - 1))))].map((i) => list[i]);
}

/** The kinds a cart call sees, in order of importance: the plan's, the named ones, then the safety net. */
export async function kindsForCart(variant: PlanVariant, plan: Plan, products: Product[]): Promise<string[]> {
  const known = new Set(products.filter((p) => p.in_stock).map((p) => p.sub_category));
  const kinds: string[] = [];
  const add = (k: string | null | undefined) => {
    if (k && known.has(k) && !kinds.includes(k)) kinds.push(k);
  };
  const search = searchFor(products);
  const bestKind = async (text: string) => (await search.search({ text, limit: 1 }))[0]?.sub_category;

  // 1. The plan's kinds. A near miss ("green tea" for "green_tea", "dals") goes to the closest kind.
  for (const raw of variant.kinds ?? []) {
    const k = raw.toLowerCase().trim().replace(/[\s-]+/g, "_");
    if (known.has(k)) add(k);
    else add(await bestKind(raw));
  }
  // 2. Named ingredients and counted kinds: the kind of that name, or else the kinds with the most matching products.
  for (const named of [...plan.must_include, plan.constraints.item_kind]) {
    if (!named) continue;
    const exact = named.toLowerCase().trim().replace(/[\s-]+/g, "_");
    if (known.has(exact)) {
      add(exact);
      continue;
    }
    const counts = new Map<string, number>();
    for (const p of products) if (p.in_stock && matchesKind(p, named)) counts.set(p.sub_category, (counts.get(p.sub_category) ?? 0) + 1);
    [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([k]) => add(k));
  }
  // 3. Safety net: the best match for each shopping-list line.
  for (const line of variant.shopping_list.split(/[;\n]/)) {
    const text = lineText(line);
    if (text) add(await bestKind(text));
  }
  return kinds.slice(0, MAX_KINDS);
}

/** The products a cart call may choose from, grouped by kind (the kinds' order is kept). */
export async function productsForCart(variant: PlanVariant, plan: Plan, products: Product[]): Promise<Map<string, Product[]>> {
  const kinds = await kindsForCart(variant, plan, products);
  const unitPrice = (p: Product) => p.price / p.pack_size;
  const out = new Map<string, Product[]>();
  for (const k of kinds) {
    const inKind = products.filter((p) => p.in_stock && p.sub_category === k).sort((a, b) => unitPrice(a) - unitPrice(b) || a.price - b.price);
    out.set(k, spread(inKind, PER_KIND));
  }
  return out;
}
