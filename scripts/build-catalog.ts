/**
 * Builds data/catalog.json from the BigBasket CSV (data/raw/bigbasket.csv)
 * plus a few hand-added staples in data/supplement.json.
 *
 * Run: npx tsx scripts/build-catalog.ts
 */
import fs from "node:fs";
import path from "node:path";
import { CatalogSchema, type Category, type Product, type Unit } from "../lib/schema";

const ROOT = path.resolve(__dirname, "..");
const CSV_PATH = path.join(ROOT, "data/raw/bigbasket.csv");
const SUPPLEMENT_PATH = path.join(ROOT, "data/supplement.json");
const OUT_PATH = path.join(ROOT, "data/catalog.json");

// Max products kept per sub_category, and max pack sizes kept per product.
const PER_SUB_CATEGORY = 10; // items (all sizes counted)
const SIZES_PER_PRODUCT = 2;
// Skip bulk packs nobody buys for one meal.
const MAX_PACK = { g: 5000, ml: 5000, pcs: 30 };

// BigBasket Category/SubCategory -> our category. Every food sub-category is kept;
// non-food (beauty, cleaning, kitchenware, baby care, pet food) is dropped.
const FOOD_CATEGORIES = new Set([
  "Foodgrains, Oil & Masala",
  "Gourmet & World Food",
  "Snacks & Branded Foods",
  "Eggs, Meat & Fish",
  "Bakery, Cakes & Dairy",
  "Beverages",
  "Fruits & Vegetables",
]);

// Sub-categories that are food-adjacent but don't help build carts.
const SKIP_SUBCATEGORIES = new Set(["Mukhwas", "Children (2-5 Yrs)", "Gift Boxes"]);

export function categoryFor(bbCategory: string, bbSub: string): Category | null {
  if (!FOOD_CATEGORIES.has(bbCategory) || SKIP_SUBCATEGORIES.has(bbSub)) return null;
  const s = bbSub.toLowerCase();
  if (bbCategory === "Eggs, Meat & Fish") return "eggs_meat";
  if (bbCategory === "Fruits & Vegetables" || s === "frozen vegetables") return "fruits_vegetables";
  if (/choco.*spread|nut spread|peanut spread/.test(s)) return "sauces_spreads";
  if (/chocolate|candy|toffee|marshmallow|cocoa/.test(s)) return "chocolates";
  if (/\boil\b|oils|ghee|vanaspati/.test(s)) return "oils_ghee";
  if (/masala|spice|salt|herbs|seasoning|cooking paste|rubs/.test(s)) return "masalas_spices";
  if (/almond|cashew|raisin|dry fruit|nuts|seeds/.test(s)) return "dry_fruits";
  if (/sauce|ketchup|dressing|dip|pickle|mayo|vinegar|jam|honey|spread|olive, jalapeno|curry paste/.test(s)) return "sauces_spreads";
  if (/poha|breakfast|oats|muesli|flakes|cereal|porridge/.test(s)) return "breakfast";
  if (bbCategory === "Beverages" || /tea|coffee|juice|drink|water|syrup|beer|aerated|sparkling/.test(s)) return "beverages";
  if (bbCategory === "Bakery, Cakes & Dairy") {
    return /milk|curd|yogurt|paneer|butter|cheese|cream|dairy|shrikhand|ice cream/.test(s) && !/cream biscuits|cream rolls/.test(s) ? "dairy" : "bakery";
  }
  if (bbCategory === "Foodgrains, Oil & Masala" || /grains|beans & pulses|flours|quinoa/.test(s)) return "atta_rice_dal";
  return "snacks";
}

// Keyword -> sub_category. First match wins, so specific words go first.
// This makes "swap" offer real alternatives (onion for onion, not onion for tomato).
const SUB_KEYWORDS: [RegExp, string][] = [
  // 1. Product forms first: "Masala Noodles" is noodles, "Tomato Ketchup" is a sauce.
  [/ready to eat|heat & eat|ready meal/i, "ready_meal"],
  [/ice cream|kulfi/i, "ice_cream"],
  [/noodles/i, "noodles"],
  [/pasta|macaroni|penne|spaghetti/i, "pasta"],
  [/ketchup|sauce/i, "sauce"],
  [/papad/i, "papad"],
  [/peanut butter|\bjam\b|marmalade|spread/i, "spread"],
  [/cookie|biscuit|wafer|rusk/i, "biscuits"],
  [/nachos?/i, "nachos"],
  [/chips|crisps|rings|puffs|kurkure/i, "chips"],
  [/bhujia|namkeen|mixture|\bsev\b|chakli|chivda/i, "namkeen"],
  [/coffee/i, "coffee"],
  [/juice|nectar/i, "juice"],
  [/coconut water/i, "coconut_water"],
  [/poha|avalakki/i, "poha"],
  [/dosa|idly|idli batter/i, "dosa_batter"],
  [/upma/i, "upma_mix"],
  [/paratha|chapati|roti/i, "frozen_bread"],
  [/\boats\b/i, "oats"],
  [/muesli|granola/i, "muesli"],
  [/\bbar\b/i, "snack_bar"],
  [/green tea/i, "green_tea"],
  [/\btea\b(?!\s*(cake|time|rusk))/i, "tea"],
  // 2. Chocolate and spice mixes.
  [/^(?!.*milk chocolate)(?=.*(dark chocolate|\d+\s?% cocoa))/i, "dark_chocolate"],
  [/chocolate|choco/i, "chocolate"],
  [/almond|badam/i, "almonds"],
  [/cashew|kaju/i, "cashews"],
  [/peanut/i, "peanuts"],
  [/garam masala/i, "garam_masala"],
  // Dish masalas get their own groups, so swaps offer chole masala for chole masala.
  [/pav ?bhaji/i, "pav_bhaji_masala"],
  [/chh?ole|chana masala/i, "chole_masala"],
  [/biri?yani/i, "biryani_masala"],
  [/chicken|tandoori/i, "chicken_masala"],
  [/meat|mutton/i, "meat_masala"],
  [/samb(h)?ar/i, "sambar_masala"],
  [/rasam/i, "rasam_masala"],
  [/cha+t|pani puri|jaljira/i, "chaat_masala"],
  [/sabzi|kitchen king|kadhai veg/i, "sabzi_masala"],
  [/rajma/i, "rajma_masala"],
  [/paneer/i, "paneer_masala"],
  [/dal makhani/i, "dal_masala"],
  [/masala|sambar|rasam/i, "masala_mix"],
  // 3. Ingredients.
  [/paneer/i, "paneer"],
  [/tofu/i, "tofu"],
  [/\bcream\b/i, "cream"],
  [/butter(?!milk)/i, "butter"],
  [/\bghee\b/i, "ghee"],
  [/\boil\b/i, "cooking_oil"],
  [/curd|dahi/i, "curd"],
  [/greek|yogurt|yoghurt|shrikhand/i, "yogurt"],
  [/cheese/i, "cheese"],
  [/\bmilk\b/i, "milk"],
  [/\beggs?\b/i, "eggs"],
  [/chicken/i, "chicken"],
  [/mutton|\blamb\b|goat/i, "mutton"],
  [/prawn|shrimp/i, "prawns"],
  [/fish|rohu|pomfret|salmon|seer|tuna|katla|basa|mackerel|sardine|tilapia/i, "fish"],
  [/\bbread\b|\bpav\b|\bbuns?\b/i, "bread"],
  [/carrot/i, "carrot"],
  [/banana/i, "banana"],
  [/\bapples?\b/i, "apple"],
  [/orange|mosambi|sweet lime/i, "citrus"],
  [/papaya/i, "papaya"],
  [/pomegranate/i, "pomegranate"],
  [/grapes?\b/i, "grapes"],
  [/guava/i, "guava"],
  [/kiwi/i, "kiwi"],
  [/pineapple/i, "pineapple"],
  [/watermelon|melon/i, "melon"],
  [/cauliflower/i, "cauliflower"],
  [/cabbage/i, "cabbage"],
  [/cucumber/i, "cucumber"],
  [/spinach|palak/i, "spinach"],
  [/capsicum|bell pepper/i, "capsicum"],
  [/mushroom/i, "mushroom"],
  [/broccoli/i, "broccoli"],
  [/lettuce/i, "lettuce"],
  [/sweet corn|\bcorn\b/i, "corn"],
  [/brinjal|baingan/i, "brinjal"],
  [/ladies finger|bhindi|okra/i, "okra"],
  [/beetroot/i, "beetroot"],
  [/\bbeans\b/i, "beans"],
  [/spring onion/i, "spring_onion"],
  [/onion/i, "onion"],
  [/tomato/i, "tomato"],
  [/potato/i, "potato"],
  [/ginger.*garlic|garlic.*ginger/i, "ginger_garlic_paste"],
  [/ginger/i, "ginger"],
  [/garlic/i, "garlic"],
  [/chilli - green|green chilli/i, "green_chilli"],
  [/curry leaves/i, "curry_leaves"],
  [/coriander leaves|dhania leaves/i, "coriander_leaves"],
  [/\bpeas\b/i, "peas"],
  [/cornflakes|corn flakes|flakes/i, "cereal"],
  [/\batta\b|whole wheat flour/i, "atta"],
  [/basmati/i, "basmati_rice"],
  [/idli rice/i, "idli_rice"],
  [/\brice\b/i, "rice"],
  [/toor|arhar/i, "toor_dal"],
  [/moong/i, "moong_dal"],
  [/chana|channa|chickpea|kabuli/i, "chana"],
  [/urad/i, "urad_dal"],
  [/rajma/i, "rajma"],
  [/masoor/i, "masoor_dal"],
  [/sooji|rava|semolina/i, "sooji"],
  [/besan|gram flour/i, "besan"],
  [/maida/i, "maida"],
  [/jaggery/i, "jaggery"],
  [/sugar ?free|stevia|sweetener/i, "sweetener"],
  [/sugar/i, "sugar"],
  [/salt/i, "salt"],
  [/kasuri methi/i, "kasuri_methi"],
  [/turmeric powder|haldi/i, "turmeric"],
  [/chill[iy] powder|mirchi powder|chilli - powder|deggi mirch/i, "chilli_powder"],
  [/coriander|dhania/i, "coriander"],
  [/cumin|jeera/i, "cumin"],
  [/mustard/i, "mustard"],
  [/honey/i, "honey"],
  [/popcorn/i, "popcorn"],
  [/raisin|kishmish/i, "raisins"],
];

const HIGH_PROTEIN = /paneer|tofu|fish|mutton|prawn|dal\b|chana|channa|rajma|moong|masoor|urad|\beggs?\b|chicken|soya|protein|peanut|almond|greek|whey|quinoa|oats|curd|dahi/i;
const NON_VEG = /chicken|mutton|fish|prawn|shrimp|\beggs?\b|\bmeat\b|\blamb\b|sausage|salami/i;
const ANIMAL = /paneer|milk|cream|butter|ghee|curd|dahi|cheese|yogurt|yoghurt|shrikhand|honey|whey|egg|chicken|chocolate|biscuit|cookie|mayo/i;
const NOT_JAIN = /onion|garlic|potato|ginger|carrot|beetroot|radish|aloo/i;
const SUGAR_FREE = /sugar ?free|no added sugar|unsweetened|sugarfree/i;

type Raw = {
  ProductName: string;
  Brand: string;
  Price: string;
  DiscountPrice: string;
  Quantity: string;
  Category: string;
  SubCategory: string;
};

/** Minimal CSV parser: handles quoted fields with commas, "" escapes and newlines. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i].trim()])));
}

/** "500 g" -> {500, g}; "1 kg" -> {1000, g}; "12 pcs" -> {12, pcs}. Multipacks ("2x200 g") and combos return null. */
export function parseSize(q: string): { pack_size: number; unit: Unit } | null {
  const m = q.trim().match(/^(\d+(?:\.\d+)?)\s*(g|gm|kg|ml|l|ltr|pcs?|pieces?)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  if (u === "kg") return { pack_size: Math.round(n * 1000), unit: "g" };
  if (u === "l" || u === "ltr") return { pack_size: Math.round(n * 1000), unit: "ml" };
  if (u === "g" || u === "gm") return { pack_size: n, unit: "g" };
  if (u === "ml") return { pack_size: n, unit: "ml" };
  return { pack_size: n, unit: "pcs" };
}

/** Shorten long marketing names: "Poha /Avalakki/Aval - Thick, Makers..." -> "Poha - Thick" */
export function cleanName(raw: string): string {
  let s = raw.replace(/�/g, "e").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*\/\s*[A-Za-z][A-Za-z ]*?(?=\s*[-/,(]|$)/g, ""); // drop "/Godihittu" style aliases
  s = s.replace(/\s*\(loose\)/i, "");
  const [head, ...rest] = s.split(/\s+-\s*/);
  let name = head.trim();
  const tail = rest.join(" - ").split(",")[0].trim();
  if (tail && tail.length <= 28) name += ` - ${tail}`;
  return name.slice(0, 70).trim();
}

// Spice-only groups: "Masala French Fries" is a snack, not a masala.
const isSpiceOnly = (sub: string) => sub === "masala_mix" || sub.endsWith("_masala");

function subCategoryFor(name: string, bbSub: string, category: Category): string {
  for (const [re, sub] of SUB_KEYWORDS) {
    if (isSpiceOnly(sub) && category !== "masalas_spices") continue;
    if (re.test(name)) return sub;
  }
  return bbSub.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
}

function tagsFor(name: string, category: Category, sub: string): string[] {
  const tags = new Set<string>();
  const veg = category === "masalas_spices" || (!NON_VEG.test(name) && category !== "eggs_meat");
  if (veg) tags.add("veg");
  if (veg && !ANIMAL.test(name) && !["dairy", "chocolates"].includes(category)) tags.add("vegan");
  if (veg && !NOT_JAIN.test(name) && !NOT_JAIN.test(sub)) tags.add("jain");
  if (HIGH_PROTEIN.test(name) && category !== "masalas_spices") tags.add("high_protein");
  if (SUGAR_FREE.test(name)) tags.add("sugar_free");
  if (category === "chocolates" || category === "dry_fruits") tags.add("gift_friendly");
  if (sub === "dark_chocolate") {
    tags.add("dark_chocolate");
    const cocoa = name.match(/(\d{2,3})\s?%\s?cocoa/i);
    if (cocoa) tags.add(`cocoa_${cocoa[1]}`);
  }
  return [...tags];
}

/** Small deterministic hash, so the same items go out of stock on every build. */
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

type Draft = Omit<Product, "id">;

function fromCsv(): Draft[] {
  const rows = parseCsv(fs.readFileSync(CSV_PATH, "utf8")) as unknown as Raw[];
  const drafts: Draft[] = [];
  for (const r of rows) {
    const category = categoryFor(r.Category, r.SubCategory);
    if (!category) continue;
    const size = parseSize(r.Quantity);
    if (!size || size.pack_size > MAX_PACK[size.unit]) continue;
    const price = Math.round(parseFloat(r.DiscountPrice));
    const mrp = Math.round(parseFloat(r.Price));
    if (!(price > 0)) continue;
    const name = cleanName(r.ProductName);
    const sub = subCategoryFor(r.ProductName, r.SubCategory, category);
    drafts.push({
      name,
      brand: r.Brand.trim() || "Unbranded",
      category,
      sub_category: sub,
      ...size,
      price,
      ...(mrp > price ? { mrp } : {}),
      in_stock: true,
      tags: tagsFor(r.ProductName, category, sub),
    });
  }
  return drafts;
}

function fromSupplement(): Draft[] {
  if (!fs.existsSync(SUPPLEMENT_PATH)) return [];
  const items = JSON.parse(fs.readFileSync(SUPPLEMENT_PATH, "utf8")) as Omit<Draft, "tags" | "in_stock">[];
  return items.map((p) => ({ ...p, in_stock: true, tags: tagsFor(p.name, p.category, p.sub_category) }));
}

/** Keep a manageable, varied set: per sub_category, the cheapest products, with at most 2 sizes each. */
function select(drafts: Draft[]): Draft[] {
  // Remove exact duplicates (same product, brand and size).
  const unique = new Map<string, Draft>();
  for (const d of drafts) {
    const key = `${d.brand}|${d.name}|${d.pack_size}${d.unit}`.toLowerCase();
    if (!unique.has(key)) unique.set(key, d);
  }

  const bySub = new Map<string, Draft[]>();
  for (const d of unique.values()) {
    const list = bySub.get(d.sub_category) ?? [];
    list.push(d);
    bySub.set(d.sub_category, list);
  }

  const kept: Draft[] = [];
  for (const [sub, list] of bySub) {
    const byProduct = new Map<string, Draft[]>();
    for (const d of list) {
      const key = `${d.brand}|${d.name}`.toLowerCase();
      byProduct.set(key, [...(byProduct.get(key) ?? []), d]);
    }
    // Sort products by cheapest unit price, so a sub-category spans budget to premium.
    const products = [...byProduct.values()]
      .map((sizes) => sizes.sort((a, b) => a.pack_size - b.pack_size).slice(0, SIZES_PER_PRODUCT))
      .sort((a, b) => a[0].price / a[0].pack_size - b[0].price / b[0].pack_size);
    // Dark chocolate drives the gift query, so keep all of it.
    const limit = sub === "dark_chocolate" ? 40 : PER_SUB_CATEGORY;
    // Spread picks across the price range (cheap, mid, premium) instead of only the cheapest.
    const last = products.length - 1;
    const order = [...new Set([0, last, Math.floor(last / 2), ...products.keys()])];
    const picks: Draft[] = [];
    for (const i of order) {
      for (const size of products[i]) if (picks.length < limit) picks.push(size);
      if (picks.length >= limit) break;
    }
    kept.push(...picks);
  }
  return kept;
}

function main() {
  const drafts = [...fromCsv(), ...fromSupplement()];
  const selected = select(drafts);

  selected.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.sub_category.localeCompare(b.sub_category) ||
      a.name.localeCompare(b.name) ||
      a.pack_size - b.pack_size,
  );

  // ~5% out of stock, but never the only item in its sub_category.
  const subCounts = new Map<string, number>();
  for (const d of selected) subCounts.set(d.sub_category, (subCounts.get(d.sub_category) ?? 0) + 1);

  const catalog: Product[] = selected.map((d, i) => ({
    id: `p${String(i + 1).padStart(3, "0")}`,
    ...d,
    in_stock: !((subCounts.get(d.sub_category) ?? 0) > 2 && hash(`${d.brand}${d.name}${d.pack_size}`) % 20 === 0),
  }));

  const parsed = CatalogSchema.safeParse(catalog);
  if (!parsed.success) {
    console.error(parsed.error.issues.slice(0, 10));
    process.exit(1);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(catalog, null, 1) + "\n");
  const out = catalog.filter((p) => !p.in_stock).length;
  const cats = new Map<string, number>();
  for (const p of catalog) cats.set(p.category, (cats.get(p.category) ?? 0) + 1);
  console.log(`Wrote ${catalog.length} products (${out} out of stock) to data/catalog.json`);
  console.log([...cats].map(([c, n]) => `  ${c}: ${n}`).join("\n"));
}

main();
