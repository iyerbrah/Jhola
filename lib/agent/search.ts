/**
 * Catalog search for the cart editor agent's search_catalog tool.
 *
 * In-memory word matching over product name, sub-category, tags, brand and category,
 * with Hindi/English grocery synonyms and filters for diet, price, category and stock.
 * The interface is async so a Postgres keyword + vector search can replace it later
 * without changing the agent.
 */
import type { Diet } from "../requirements";
import { packLabel, type Category, type Product } from "../schema";

export type SearchQuery = {
  text: string;
  diet?: Diet | null;
  max_price?: number | null;
  category?: Category | null;
  /** Out-of-stock products are hidden unless this is true. */
  include_out_of_stock?: boolean;
  limit?: number;
};

/** What the agent sees for each product: enough to choose, nothing it could misuse. */
export type SearchHit = {
  id: string;
  name: string;
  brand: string;
  pack: string;
  price: number;
  sub_category: string;
  tags: string[];
  in_stock: boolean;
};

export interface CatalogSearch {
  search(query: SearchQuery): Promise<SearchHit[]>;
}

export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 20;

const STOPWORDS = new Set(
  ("a add an and any are as buy for from get good i in is it like me my need nice of on or pack packet please some something " +
    "the to want with without x g gm gms kg ml l ltr litre pcs piece pieces").split(" "),
);

/**
 * Words shoppers (and the model) use that the catalog spells differently. Each entry maps
 * a word or two-word phrase to the catalog words that mean the same thing.
 */
const SYNONYMS: Record<string, string[]> = {
  // Hindi -> catalog
  palak: ["spinach"],
  dahi: ["curd"],
  aloo: ["potato"],
  alu: ["potato"],
  pyaz: ["onion"],
  pyaaz: ["onion"],
  kanda: ["onion"],
  tamatar: ["tomato"],
  jeera: ["cumin"],
  haldi: ["turmeric"],
  mirch: ["chilli"],
  dhania: ["coriander"],
  adrak: ["ginger"],
  lehsun: ["garlic"],
  lahsun: ["garlic"],
  chawal: ["rice"],
  doodh: ["milk"],
  makhan: ["butter"],
  makkhan: ["butter"],
  gobi: ["cauliflower", "cabbage"],
  bhindi: ["okra"],
  matar: ["peas"],
  baingan: ["brinjal"],
  methi: ["fenugreek", "methi"],
  elaichi: ["cardamom"],
  gud: ["jaggery"],
  gur: ["jaggery"],
  chini: ["sugar"],
  namak: ["salt"],
  anda: ["egg"],
  ande: ["egg"],
  murgh: ["chicken"],
  murgi: ["chicken"],
  machli: ["fish"],
  machhi: ["fish"],
  jhinga: ["prawn"],
  gosht: ["mutton"],
  suji: ["sooji"],
  rava: ["sooji"],
  sabudana: ["sabudana", "sago"],
  kaju: ["cashew"],
  badam: ["almond"],
  kishmish: ["raisin"],
  chai: ["tea"],
  nimbu: ["lemon"],
  // English -> catalog
  semolina: ["sooji"],
  yogurt: ["curd", "yogurt"],
  yoghurt: ["curd", "yogurt"],
  chickpea: ["chana"],
  eggplant: ["brinjal"],
  aubergine: ["brinjal"],
  cilantro: ["coriander"],
  chili: ["chilli"],
  chilly: ["chilli"],
  pepper: ["capsicum", "pepper"],
  "gram flour": ["besan"],
  "chickpea flour": ["besan"],
  "kidney bean": ["rajma"],
  "ladies finger": ["okra"],
  "lady finger": ["okra"],
  "bell pepper": ["capsicum"],
  "cottage cheese": ["paneer"],
  "all purpose": ["maida"],
  "refined flour": ["maida"],
  "wheat flour": ["atta"],
  "flattened rice": ["poha"],
  "cooking oil": ["oil"],
  "soft drink": ["soft", "cold", "aerated"],
  pav: ["pav", "bread"],
  // Ideas -> kinds of product (chocolate is left out on purpose: the agent can search for it by name)
  dessert: ["dessert", "ice", "sweet", "mousse", "brownie", "pastry", "kulfi"],
  sweets: ["sweet", "dessert"],
  snack: ["snack", "namkeen", "chip"],
};

/** Plural and simple word-form folding: tomatoes -> tomato, chillies -> chilli, eggs -> egg. */
function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "i";
  if (w.endsWith("oes")) return w.slice(0, -2);
  if (/(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);

/** Each query word or phrase becomes a group of alternatives; a product matches a group if it matches any of them. */
function queryGroups(text: string): string[][] {
  const tokens = words(text).filter((w) => !STOPWORDS.has(w));
  const groups: string[][] = [];
  for (let i = 0; i < tokens.length; i++) {
    const pair = i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : "";
    if (pair && SYNONYMS[pair]) {
      groups.push(SYNONYMS[pair].map(stem));
      i++;
      continue;
    }
    const t = tokens[i];
    groups.push([...new Set([t, ...(SYNONYMS[t] ?? []).map(stem)])]);
  }
  return groups;
}

type Indexed = { p: Product; fields: { words: Set<string>; weight: number }[]; sub: string; forms: Set<string> };

// How much a match in each field counts: what a product is (sub-category, name) beats who makes it.
const WEIGHTS = { sub_category: 4, name: 3, tags: 2, brand: 1.5, category: 1 };
/** Extra when the query (or one word of it) is the whole sub-category: "paneer" -> paneer, not paneer_masala. */
const EXACT_SUB_BONUS = 2;
/**
 * Words that make a product a different form of the thing searched for. A product named with one
 * the query didn't use ranks a little lower: "rice" puts rice before rice flour, "pav" pav before pav bhaji masala.
 */
const FORM_WORDS = new Set(["flour", "powder", "paste", "masala", "mix", "sauce", "cake", "chip", "flake", "noodle", "pickle", "drink", "milkshake"]);
const FORM_PENALTY = 1.5;

function indexProduct(p: Product): Indexed {
  const field = (text: string, weight: number) => ({ words: new Set(words(text)), weight });
  const nameAndSub = words(`${p.name} ${p.sub_category.replace(/_/g, " ")}`);
  return {
    p,
    sub: words(p.sub_category.replace(/_/g, " ")).join(" "),
    forms: new Set(nameAndSub.filter((w) => FORM_WORDS.has(w))),
    fields: [
      field(p.sub_category.replace(/_/g, " "), WEIGHTS.sub_category),
      field(p.name, WEIGHTS.name),
      field(p.tags.join(" ").replace(/_/g, " "), WEIGHTS.tags),
      field(p.brand, WEIGHTS.brand),
      field(p.category.replace(/_/g, " "), WEIGHTS.category),
    ],
  };
}

/**
 * Spelling variants one letter apart that plural folding misses ("cookie" ~ "cooki"). Kept this tight
 * on purpose: looser prefixes matched different words ("cooki" ~ "cooking", "palak" ~ "palakkad").
 */
const prefixMatch = (a: string, b: string) =>
  Math.min(a.length, b.length) >= 4 && Math.abs(a.length - b.length) <= 1 && (a.startsWith(b) || b.startsWith(a));

/**
 * How well a product matches one query word or phrase (0 = not at all): each field counts once,
 * with its best alternative. Near-spellings count half.
 */
function groupScore(item: Indexed, group: string[]): number {
  let score = 0;
  for (const f of item.fields) {
    let best = 0;
    for (const alt of group) {
      if (f.words.has(alt)) best = f.weight;
      else for (const w of f.words) if (prefixMatch(w, alt)) best = Math.max(best, f.weight / 2);
      if (best === f.weight) break;
    }
    score += best;
  }
  if (score > 0 && group.some((alt) => item.sub === alt)) score += EXACT_SUB_BONUS;
  return score;
}

export function toHit(p: Product): SearchHit {
  return { id: p.id, name: p.name, brand: p.brand, pack: packLabel(p), price: p.price, sub_category: p.sub_category, tags: p.tags, in_stock: p.in_stock };
}

/**
 * Ranks by how many query words a product matches, then how well, then price (cheapest first).
 * A product must match at least one query word. Filters apply before ranking.
 */
export function createMemorySearch(products: Product[]): CatalogSearch {
  const indexed = products.map(indexProduct);
  return {
    async search({ text, diet, max_price, category, include_out_of_stock = false, limit = DEFAULT_LIMIT }) {
      const groups = queryGroups(text);
      if (groups.length === 0) return [];
      const queryWords = new Set(groups.flat().flatMap((alt) => alt.split(" ")));
      const phrase = groups.map((g) => g[0]).join(" ");
      const n = Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
      const scored: { item: Indexed; matched: number; score: number }[] = [];
      for (const item of indexed) {
        const { p } = item;
        if (!include_out_of_stock && !p.in_stock) continue;
        if (diet && !p.tags.includes(diet)) continue;
        if (max_price != null && p.price > max_price) continue;
        if (category && p.category !== category) continue;
        let matched = 0;
        let score = 0;
        for (const g of groups) {
          const s = groupScore(item, g);
          if (s > 0) matched++;
          score += s;
        }
        if (matched === 0) continue;
        // The whole query names the sub-category ("green tea", "toor dal").
        if (groups.length > 1 && item.sub === phrase) score += EXACT_SUB_BONUS * 2;
        if ([...item.forms].some((f) => !queryWords.has(f))) score -= FORM_PENALTY;
        scored.push({ item, matched, score });
      }
      scored.sort(
        (a, b) =>
          b.matched - a.matched ||
          b.score - a.score ||
          Number(b.item.p.in_stock) - Number(a.item.p.in_stock) ||
          a.item.p.price - b.item.p.price ||
          a.item.p.name.localeCompare(b.item.p.name),
      );
      return scored.slice(0, n).map((s) => toHit(s.item.p));
    },
  };
}
