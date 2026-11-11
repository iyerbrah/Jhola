/**
 * The catalog pipeline: BigBasket CSV rows (plus a few hand-added staples) in, data/catalog.json out.
 * Pure functions only, so tests can run it on a small fixture. scripts/build-catalog.ts does the file IO.
 *
 * Steps:
 *  1. rows -> drafts: map each row to a category and a sub_category ("kind"), parse the pack size,
 *     tag diets (food only), and drop rows that fail a quality check (each drop is counted in the report).
 *  2. select: remove duplicates and keep a varied set per kind. Products that already have an ID are always kept.
 *  3. assign IDs from the ledger (data/catalog/ids.json): a product keeps its ID across rebuilds, new ones are appended.
 */
import { CatalogSchema, isFood, type Category, type Product, type Unit } from "../../lib/schema";

// ---------- Limits ----------

/** Most products kept per kind (all sizes counted). Food keeps nearly everything; non-food keeps a varied few. */
export const PER_KIND = { food: 100, nonFood: 10 };
const SIZES_PER_PRODUCT = 2;
/** Skip bulk packs nobody buys for one order. Non-food comes in bigger counts (diapers, tissues). */
const MAX_PACK = { food: { g: 5000, ml: 5000, pcs: 30 }, nonFood: { g: 5000, ml: 5000, pcs: 200 } };
/** Nothing in a quick-commerce cart costs more than this. */
const MAX_PRICE = 3000;
/** A product is a price outlier if its price per gram/ml/piece is this many times its kind's median. */
const OUTLIER_FACTOR = 20;

// ---------- Categories ----------

const FOOD_SOURCES = new Set([
  "Foodgrains, Oil & Masala",
  "Gourmet & World Food",
  "Snacks & Branded Foods",
  "Eggs, Meat & Fish",
  "Bakery, Cakes & Dairy",
  "Beverages",
  "Fruits & Vegetables",
]);

/**
 * Sub-categories left out. Food: not useful for carts. Non-food: medicine and supplements (Jhola gives no
 * health advice), luxury perfume, gift sets and seasonal items.
 */
const SKIP_SUBCATEGORIES = new Set([
  "Mukhwas",
  "Children (2-5 Yrs)",
  "Gift Boxes",
  "Everyday Medicine",
  "Supplements & Proteins",
  "Ayurveda",
  "Sexual Wellness",
  "Eau De Parfum",
  "Eau De Toilette",
  "Eau De Cologne",
  "Perfume",
  "Attar",
  "Aromatherapy",
  "Gift Sets",
  "Combos & Gift Sets",
  "Makeup Kits & Gift Sets",
  "Baby Gift Sets",
  "Rakhi",
  "Holi Colours & Pichkari",
  "Seasonal Accessories",
  "Games & Calculators",
  "Electronic Accessories",
]);

function categoryFor(bbCategory: string, bbSub: string): Category | null {
  if (SKIP_SUBCATEGORIES.has(bbSub)) return null;
  const s = bbSub.toLowerCase();
  if (bbCategory === "Beauty & Hygiene") return "personal_care";
  if (bbCategory === "Cleaning & Household") return "cleaning_household";
  if (bbCategory === "Baby Care") return "baby_care";
  if (bbCategory === "Kitchen, Garden & Pets") return s.startsWith("pet ") ? "pet_care" : "home_kitchen";
  if (!FOOD_SOURCES.has(bbCategory)) return null;
  if (bbCategory === "Eggs, Meat & Fish") return "eggs_meat";
  if (bbCategory === "Fruits & Vegetables" || s === "frozen vegetables") return "fruits_vegetables";
  if (/choco.*spread|nut spread|peanut spread/.test(s)) return "sauces_spreads";
  if (/chocolate|candy|toffee|marshmallow|cocoa/.test(s)) return "chocolates";
  if (/\boil\b|oils|ghee|vanaspati/.test(s)) return "oils_ghee";
  if (/masala|spice|salt|herbs|seasoning|cooking paste|rubs/.test(s)) return "masalas_spices";
  if (/almond|cashew|raisin|dry fruit|nuts|seeds/.test(s)) return "dry_fruits";
  if (/sauce|ketchup|dressing|dip|pickle|mayo|vinegar|jam|honey|spread|olive, jalapeno|curry paste/.test(s)) return "sauces_spreads";
  if (/poha|breakfast|oats|muesli|flakes|cereal|porridge/.test(s)) return "breakfast";
  // Whole words: "Boiled & Steam Rice" isn't tea.
  if (bbCategory === "Beverages" || /\btea\b|coffee|juice|drink|water|syrup|beer|aerated|sparkling/.test(s)) return "beverages";
  if (bbCategory === "Bakery, Cakes & Dairy") {
    return /milk|curd|yogurt|paneer|butter|cheese|cream|dairy|shrikhand|ice cream/.test(s) && !/cream biscuits|cream rolls/.test(s) ? "dairy" : "bakery";
  }
  if (bbCategory === "Foodgrains, Oil & Masala" || /grains|beans & pulses|flours|quinoa/.test(s)) return "atta_rice_dal";
  return "snacks";
}

// ---------- Kinds (sub_category) ----------

const F = "fruits_vegetables" as const;

/**
 * Keyword -> kind for food, first match wins, so specific words go first. This makes "swap" offer real
 * alternatives (onion for onion, not onion for tomato).
 *
 * The optional third entry is the kind's home: the categories it can belong to. A keyword outside its home
 * is skipped, so "Chicken Seekh Kabab Malai N Cheese" isn't cheese and "Ghee Khakhra" isn't ghee.
 */
const KEYWORDS: [RegExp, string, Category[]?][] = [
  // 1. Product forms first: "Masala Noodles" is noodles, "Tomato Ketchup" is a sauce.
  [/ready to eat|heat & eat|ready meal/i, "ready_meal"],
  [/ice cream|kulfi/i, "ice_cream", ["dairy"]],
  [/noodles/i, "noodles"],
  [/pasta|macaroni|penne|spaghetti/i, "pasta", ["snacks", "atta_rice_dal"]],
  [/ketchup|sauce/i, "sauce"],
  [/papad/i, "papad"],
  [/peanut butter|\bjam\b|marmalade|spread/i, "spread"],
  [/cookie|biscuit|wafer|rusk/i, "biscuits"],
  [/nachos?/i, "nachos"],
  [/chips|crisps|rings|puffs|kurkure/i, "chips"],
  [/coffee/i, "coffee", ["beverages"]],
  [/poha|avalakki/i, "poha", ["breakfast", "atta_rice_dal"]],
  [/bhujia|namkeen|mixture|\bsev\b|chakli|chivda/i, "namkeen"],
  [/juice|nectar/i, "juice", ["beverages"]],
  [/coconut water/i, "coconut_water", ["beverages", F]],
  [/dosa|idly|idli batter/i, "dosa_batter", ["breakfast", "atta_rice_dal"]],
  [/upma/i, "upma_mix"],
  [/paratha|chapati|roti/i, "frozen_bread", ["snacks", "bakery"]],
  [/\boats\b/i, "oats", ["breakfast"]],
  [/muesli|granola/i, "muesli", ["breakfast"]],
  [/\bbar\b/i, "snack_bar", ["breakfast", "snacks"]],
  [/green tea/i, "green_tea", ["beverages"]],
  [/\btea\b(?!\s*(cake|time|rusk))/i, "tea", ["beverages"]],
  // 2. Chocolate and spice mixes.
  [/^(?!.*milk chocolate)(?=.*(dark chocolate|\d+\s?% cocoa))/i, "dark_chocolate", ["chocolates"]],
  [/chocolate|choco/i, "chocolate", ["chocolates"]],
  [/almond|badam/i, "almonds", ["dry_fruits"]],
  [/cashew|kaju/i, "cashews", ["dry_fruits"]],
  [/peanut/i, "peanuts", ["dry_fruits", "snacks", "atta_rice_dal", "breakfast"]],
  [/garam masala/i, "garam_masala", ["masalas_spices"]],
  // Dish masalas get their own groups, so swaps offer chole masala for chole masala.
  [/pav ?bhaji/i, "pav_bhaji_masala", ["masalas_spices"]],
  [/chh?ole|chana masala/i, "chole_masala", ["masalas_spices"]],
  [/biri?yani/i, "biryani_masala", ["masalas_spices"]],
  [/chicken|tandoori/i, "chicken_masala", ["masalas_spices"]],
  [/meat|mutton/i, "meat_masala", ["masalas_spices"]],
  [/samb(h)?ar/i, "sambar_masala", ["masalas_spices"]],
  [/rasam/i, "rasam_masala", ["masalas_spices"]],
  [/cha+t|pani puri|jaljira/i, "chaat_masala", ["masalas_spices"]],
  [/sabzi|kitchen king|kadhai veg/i, "sabzi_masala", ["masalas_spices"]],
  [/rajma/i, "rajma_masala", ["masalas_spices"]],
  [/paneer/i, "paneer_masala", ["masalas_spices"]],
  [/dal makhani/i, "dal_masala", ["masalas_spices"]],
  [/masala|sambar|rasam/i, "masala_mix", ["masalas_spices"]],
  // 3. Ingredients. Flours are a form: "Rice Flour" isn't rice, "Banana Flour" isn't a banana.
  [/(?<!wheat |gram )\bflour\b/i, "flour", ["atta_rice_dal"]],
  [/paneer/i, "paneer", ["dairy"]],
  [/tofu/i, "tofu"],
  [/\bcream\b/i, "cream", ["dairy", "bakery"]],
  [/butter(?!milk|scotch)/i, "butter", ["dairy"]],
  [/\bghee\b/i, "ghee", ["oils_ghee"]],
  [/\boil\b/i, "cooking_oil", ["oils_ghee"]],
  [/curd|dahi/i, "curd", ["dairy"]],
  [/greek|yogurt|yoghurt|shrikhand/i, "yogurt", ["dairy"]],
  [/cheese/i, "cheese", ["dairy"]],
  [/\bmilk\b/i, "milk", ["dairy"]],
  [/\beggs?\b/i, "eggs", ["eggs_meat"]],
  // Meat that isn't a plain cut gets its own kind, so a budget chicken biryani gets curry-cut chicken,
  // not the cheapest liver or a marinated tikka.
  [/liver|gizzard|kidney|\bpaya\b|\bfat\b|brain|soup pieces/i, "offal_and_bones", ["eggs_meat"]],
  [/tikka|kabab|kebab|seekh|patty|pops|nuggets?|supreme|crispy|peri.?peri|bbq|tandoori|hariyali|afghani|lollipop|lollypop|chilli chicken|achari|sausage|salami|marinated/i, "ready_to_cook_meat", ["eggs_meat"]],
  [/chicken/i, "chicken", ["eggs_meat"]],
  [/mutton|\blamb\b|goat/i, "mutton", ["eggs_meat"]],
  [/prawn|shrimp/i, "prawns", ["eggs_meat"]],
  [/fish|rohu|pomfret|salmon|seer|tuna|katla|basa|mackerel|sardine|tilapia/i, "fish", ["eggs_meat"]],
  [/\bbread\b|\bpav\b|\bbuns?\b/i, "bread", ["bakery"]],
  [/carrot/i, "carrot", [F]],
  [/banana/i, "banana", [F]],
  [/\bapples?\b/i, "apple", [F]],
  [/orange|mosambi|sweet lime/i, "citrus", [F]],
  [/papaya/i, "papaya", [F]],
  [/pomegranate/i, "pomegranate", [F]],
  [/grapes?\b/i, "grapes", [F]],
  [/guava/i, "guava", [F]],
  [/kiwi/i, "kiwi", [F]],
  [/pineapple/i, "pineapple", [F]],
  [/watermelon|melon/i, "melon", [F]],
  [/cauliflower/i, "cauliflower", [F]],
  [/cabbage/i, "cabbage", [F]],
  [/cucumber/i, "cucumber", [F]],
  // Whole words: "Palakkad Matta Rice" is rice, not spinach.
  [/spinach|\bpalak\b/i, "spinach", [F]],
  [/capsicum|bell pepper/i, "capsicum", [F]],
  [/mushroom/i, "mushroom", [F]],
  [/broccoli/i, "broccoli", [F]],
  [/lettuce/i, "lettuce", [F]],
  [/sweet corn|\bcorn\b/i, "corn", [F]],
  [/brinjal|baingan/i, "brinjal", [F]],
  [/ladies finger|bhindi|okra/i, "okra", [F]],
  [/beetroot/i, "beetroot", [F]],
  [/\bbeans\b/i, "beans", [F, "atta_rice_dal"]],
  [/spring onion/i, "spring_onion", [F]],
  [/onion/i, "onion", [F]],
  [/tomato/i, "tomato", [F]],
  [/potato/i, "potato", [F]],
  [/ginger.*garlic|garlic.*ginger/i, "ginger_garlic_paste"],
  [/ginger/i, "ginger", [F, "masalas_spices"]],
  [/garlic/i, "garlic", [F, "masalas_spices"]],
  [/chilli - green|green chilli/i, "green_chilli", [F]],
  [/curry leaves/i, "curry_leaves", [F]],
  [/coriander leaves|dhania leaves/i, "coriander_leaves", [F]],
  [/\bpeas\b/i, "peas", [F, "atta_rice_dal"]],
  [/cornflakes|corn flakes|flakes/i, "cereal", ["breakfast"]],
  [/\batta\b|whole wheat flour/i, "atta", ["atta_rice_dal"]],
  [/basmati/i, "basmati_rice", ["atta_rice_dal"]],
  [/idli rice/i, "idli_rice", ["atta_rice_dal"]],
  [/\brice\b/i, "rice", ["atta_rice_dal"]],
  [/toor|arhar/i, "toor_dal", ["atta_rice_dal"]],
  [/moong/i, "moong_dal", ["atta_rice_dal"]],
  [/chana|channa|chickpea|kabuli/i, "chana", ["atta_rice_dal"]],
  [/urad/i, "urad_dal", ["atta_rice_dal"]],
  [/rajma/i, "rajma", ["atta_rice_dal"]],
  [/masoor/i, "masoor_dal", ["atta_rice_dal"]],
  [/sooji|rava|semolina/i, "sooji", ["atta_rice_dal"]],
  [/besan|gram flour/i, "besan", ["atta_rice_dal"]],
  [/maida/i, "maida", ["atta_rice_dal"]],
  [/jaggery/i, "jaggery", ["atta_rice_dal", "masalas_spices"]],
  [/sugar ?free|stevia|sweetener/i, "sweetener", ["atta_rice_dal", "masalas_spices"]],
  [/sugar/i, "sugar", ["atta_rice_dal", "masalas_spices"]],
  [/\bsalt\b/i, "salt", ["masalas_spices", "dry_fruits", "atta_rice_dal"]],
  [/kasuri methi/i, "kasuri_methi", ["masalas_spices"]],
  [/turmeric powder|haldi/i, "turmeric", ["masalas_spices"]],
  [/chill[iy] powder|mirchi powder|chilli - powder|deggi mirch/i, "chilli_powder", ["masalas_spices"]],
  [/coriander|dhania/i, "coriander", ["masalas_spices", F]],
  [/cumin|jeera/i, "cumin", ["masalas_spices"]],
  [/mustard/i, "mustard", ["masalas_spices"]],
  [/honey/i, "honey", ["sauces_spreads"]],
  [/popcorn/i, "popcorn"],
  [/raisin|kishmish/i, "raisins", ["dry_fruits"]],
];

/** Non-food kinds: short names for BigBasket's sub-categories, so "detergent" swaps with "detergent". */
const NON_FOOD_KINDS: Record<string, string> = {
  "Bathing Bars & Soaps": "soap",
  "Shower Gel & Body Wash": "body_wash",
  "Hand Wash & Sanitizers": "hand_wash",
  Toothpaste: "toothpaste",
  Toothbrush: "toothbrush",
  Mouthwash: "mouthwash",
  "Hair Oil & Serum": "hair_oil",
  "Shaving Care": "shaving",
  "Men's Deodorants": "deodorant",
  "Women's Deodorants": "deodorant",
  "Body Sprays & Mists": "deodorant",
  "Sanitary Napkins": "sanitary_pads",
  "Detergent Powder, Liquid": "detergent",
  "Dishwash Liquids & Pastes": "dishwash",
  "Dishwash Bars & Powders": "dishwash",
  "Toilet Cleaners": "toilet_cleaner",
  "Floor & Other Cleaners": "floor_cleaner",
  "Kitchen, Glass & Drain": "floor_cleaner",
  "Disinfectant Spray & Cleaners": "disinfectant",
  "Fabric Pre, Post Wash": "fabric_care",
  "Utensil Scrub-Pad, Glove": "scrub_pad",
  "Aluminium Foil, Clingwrap": "foil_wrap",
  "Paper Napkin, Tissue Box": "tissues",
  "Toilet Paper": "toilet_paper",
  "Mosquito Repellent": "mosquito_repellent",
  "Agarbatti, Incense Sticks": "agarbatti",
  "Candles & Match Box": "candles_matches",
  Diapers: "diapers",
  "Baby Wipes": "baby_wipes",
};

/** Big non-food groups, split by what the product is, first match wins. */
const NON_FOOD_KEYWORDS: Record<string, [RegExp, string][]> = {
  "Face Care": [
    [/face ?wash|cleanser|micellar/i, "face_wash"],
    [/sunscreen|sun ?screen|\bspf\b/i, "sunscreen"],
    [/toner|rose water/i, "toner"],
    [/scrub/i, "face_scrub"],
    [/mask|peel/i, "face_mask"],
    [/serum/i, "face_serum"],
    [/cream|moisturi[sz]|lotion|gel/i, "face_cream"],
  ],
  "Shampoo & Conditioner": [
    [/^(?!.*shampoo).*conditioner/i, "conditioner"],
    [/./, "shampoo"],
  ],
  "Body Care": [
    [/lotion|body milk/i, "body_lotion"],
    [/petroleum jelly|vaseline/i, "petroleum_jelly"],
  ],
  "Pet Meals & Treats": [
    [/\bcats?\b|kitten/i, "cat_food"],
    [/./, "dog_food"],
  ],
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");

// Spice-only groups: "Masala French Fries" is a snack, not a masala.
const isSpiceOnly = (sub: string) => sub === "masala_mix" || sub.endsWith("_masala");

/** A keyword match that was skipped because the product is outside the kind's home. */
export type HomeSkip = { name: string; category: Category; keyword_kind: string; kind: string };

/** The product's kind. `skipped` lists keyword matches outside their home, for the report. */
function subCategoryFor(name: string, bbSub: string, category: Category, skipped: HomeSkip[] = []): string {
  if (!isFood({ category })) {
    for (const [re, sub] of NON_FOOD_KEYWORDS[bbSub] ?? []) if (re.test(name)) return sub;
    return NON_FOOD_KINDS[bbSub] ?? slug(bbSub);
  }
  const misses: string[] = [];
  let kind: string | null = null;
  for (const [re, sub, home] of KEYWORDS) {
    if (isSpiceOnly(sub) && category !== "masalas_spices") continue;
    if (!re.test(name)) continue;
    if (home && !home.includes(category)) {
      misses.push(sub);
      continue;
    }
    kind = sub;
    break;
  }
  kind ??= slug(bbSub);
  for (const m of misses) skipped.push({ name, category, keyword_kind: m, kind });
  return kind;
}

// ---------- Names, sizes and tags ----------

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

// Marketing phrases that aren't part of a product's name ("Rich In Dietary Fibre", "Helps To Detox").
const MARKETING =
  /\b(rich in|high in|helps?|boosts?|perfect for|made with|enhances|adds? flavou?r|no added|source of|stays? softer|good for|ideal for|used (o|f)r|for longer|great for|with goodness|nutritious|healthy cooking|trans fat free|antibiotic residue|provides)\b.*$/i;

/** Shorten long marketing names: "Poha /Avalakki/Aval - Thick, Makers..." -> "Poha - Thick" */
function cleanName(raw: string): string {
  let s = raw.replace(/�/g, "e").replace(/Â/g, "").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*\/\s*[A-Za-z][A-Za-z ]*?(?=\s*[-/,(]|$)/g, ""); // drop "/Godihittu" style aliases
  s = s.replace(/\s*\(loose\)/i, "");
  // Split into "head - tail" on any dash or pipe, including "Cereal- Rich" with no space before the dash.
  const [head, ...rest] = s.split(/\s*\|\s*|\s+[-–—]\s*|(?<=\w)-\s+/);
  let name = head.split(",")[0].replace(MARKETING, "").trim();
  const tail = rest.join(" - ").split(",")[0].replace(MARKETING, "").trim();
  if (!name) name = tail; // e.g. "Aval/Avalakki - Flattened & Beaten Rice" once the aliases are gone
  else if (tail && tail.length <= 24 && name.length + tail.length <= 44) name += ` - ${tail}`;
  // Keep it short, cutting at a word boundary.
  if (name.length > 44) name = name.slice(0, 44).replace(/\s+\S*$/, "");
  return name.replace(/[\s,&-]+$/, "").trim();
}

const HIGH_PROTEIN = /paneer|tofu|fish|mutton|prawn|dal\b|chana|channa|rajma|moong|masoor|urad|\beggs?\b|chicken|soya|protein|peanut|almond|greek|whey|quinoa|oats|curd|dahi/i;
const NON_VEG = /chicken|mutton|fish|prawn|shrimp|\beggs?\b|\bmeat\b|\blamb\b|sausage|salami/i;
const ANIMAL = /paneer|milk|cream|butter|ghee|curd|dahi|cheese|yogurt|yoghurt|shrikhand|honey|whey|egg|chicken|chocolate|biscuit|cookie|mayo/i;
const NOT_JAIN = /onion|garlic|potato|ginger|carrot|beetroot|radish|aloo/i;
const SUGAR_FREE = /sugar ?free|no added sugar|unsweetened|sugarfree/i;

/** Diet and other tags. Non-food gets none: diets don't apply to it. */
function tagsFor(name: string, category: Category, sub: string): string[] {
  if (!isFood({ category })) return [];
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

// ---------- CSV ----------

export type Row = {
  ProductName: string;
  Brand: string;
  Price: string;
  DiscountPrice: string;
  Quantity: string;
  Category: string;
  SubCategory: string;
};

/** Minimal CSV parser: handles quoted fields with commas, "" escapes and newlines. */
export function parseCsv(text: string): Record<string, string>[] {
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

// ---------- Build ----------

/** A product before it has an ID. `source` identifies the row it came from, for the ID ledger. */
export type Draft = Omit<Product, "id"> & { source: string };
export type SupplementItem = Omit<Product, "id" | "tags" | "in_stock">;
/** Source identity -> product ID. Never edit an entry: it's what keeps IDs stable. */
export type Ledger = Record<string, string>;

export type Report = {
  products: number;
  food: number;
  non_food: number;
  out_of_stock: number;
  new_products: number;
  by_category: Record<string, number>;
  kinds: number;
  /** Rows dropped before selection, by reason. */
  dropped: Record<string, number>;
  /** Examples of rows dropped as price outliers (a few per build is normal: bad source data). */
  price_outliers: { name: string; brand: string; pack: string; price: number; kind: string }[];
  /** Keyword matches skipped because the product is outside the kind's home (the misfiling guard). */
  home_skips: { count: number; examples: HomeSkip[] };
  /** IDs in the ledger whose source row is gone. Kept from the last catalog, out of stock. */
  retired: string[];
};

const rowKey = (r: Row) => `bb:${r.ProductName}|${r.Brand}|${r.Quantity}`;
const supplementKey = (p: SupplementItem) => `sup:${p.brand}|${p.name}|${p.pack_size}${p.unit}`;
const productKey = (p: { brand: string; name: string; pack_size: number; unit: string }) => `${p.brand}|${p.name}|${p.pack_size}${p.unit}`.toLowerCase();

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function drafts(rows: Row[], supplement: SupplementItem[], report: Report, skips: HomeSkip[]): Draft[] {
  const drop = (reason: string) => (report.dropped[reason] = (report.dropped[reason] ?? 0) + 1);
  const out: Draft[] = [];
  for (const r of rows) {
    const category = categoryFor(r.Category, r.SubCategory);
    if (!category) {
      drop("category not sold");
      continue;
    }
    const size = parseSize(r.Quantity);
    if (!size) {
      drop("multipack or combo");
      continue;
    }
    if (size.pack_size > MAX_PACK[isFood({ category }) ? "food" : "nonFood"][size.unit]) {
      drop("bulk pack");
      continue;
    }
    const price = Math.round(parseFloat(r.DiscountPrice));
    const mrp = Math.round(parseFloat(r.Price));
    if (!(price > 0) || price > MAX_PRICE) {
      drop(price > 0 ? `price over ₹${MAX_PRICE}` : "no price");
      continue;
    }
    const name = cleanName(r.ProductName);
    if (name.length < 2) {
      drop("no name");
      continue;
    }
    const sub = subCategoryFor(r.ProductName, r.SubCategory, category, skips);
    out.push({
      source: rowKey(r),
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
  for (const p of supplement) out.push({ ...p, source: supplementKey(p), in_stock: true, tags: tagsFor(p.name, p.category, p.sub_category) });

  // Price outliers: far above their kind's median price per unit, usually a bad row (a multipack priced as one).
  const perUnit = (d: Draft) => d.price / d.pack_size;
  const byKind = new Map<string, number[]>();
  for (const d of out) byKind.set(`${d.sub_category}|${d.unit}`, [...(byKind.get(`${d.sub_category}|${d.unit}`) ?? []), perUnit(d)]);
  return out.filter((d) => {
    const prices = byKind.get(`${d.sub_category}|${d.unit}`)!;
    if (prices.length < 5 || perUnit(d) <= OUTLIER_FACTOR * median(prices)) return true;
    drop("price outlier");
    report.price_outliers.push({ name: d.name, brand: d.brand, pack: `${d.pack_size} ${d.unit}`, price: d.price, kind: d.sub_category });
    return false;
  });
}

/**
 * A varied set per kind: at most SIZES_PER_PRODUCT sizes of each product, picks spread from cheap to premium.
 * Duplicates (same brand, name and size) are removed, keeping a row that already has an ID.
 * Products in `keep` (they have IDs) are always kept and count toward their kind's limit.
 */
export function select(all: Draft[], keep: Set<string>, report?: Report): Draft[] {
  const unique = new Map<string, Draft>();
  for (const d of all) {
    // Kitchen and household items come in many colours of one product; keep one.
    const name = ["home_kitchen", "cleaning_household"].includes(d.category) ? d.name.split(" - ")[0] : d.name;
    const key = productKey({ ...d, name });
    const seen = unique.get(key);
    if (!seen || (!keep.has(seen.source) && keep.has(d.source))) unique.set(key, d);
  }
  if (report) report.dropped["duplicate"] = all.length - unique.size;

  const byKind = new Map<string, Draft[]>();
  for (const d of unique.values()) byKind.set(d.sub_category, [...(byKind.get(d.sub_category) ?? []), d]);

  const kept: Draft[] = [];
  for (const [sub, list] of byKind) {
    const picks = list.filter((d) => keep.has(d.source));
    const byProduct = new Map<string, Draft[]>();
    for (const d of list) {
      const key = `${d.brand}|${d.name}`.toLowerCase();
      byProduct.set(key, [...(byProduct.get(key) ?? []), d]);
    }
    // New sizes to choose from: the smallest ones, up to SIZES_PER_PRODUCT counting the sizes already kept.
    // Sorted by unit price, so a kind spans budget to premium.
    const products = [...byProduct.values()]
      .map((sizes) => {
        const room = SIZES_PER_PRODUCT - sizes.filter((d) => keep.has(d.source)).length;
        return sizes.filter((d) => !keep.has(d.source)).sort((a, b) => a.pack_size - b.pack_size).slice(0, Math.max(0, room));
      })
      .filter((sizes) => sizes.length > 0)
      .sort((a, b) => a[0].price / a[0].pack_size - b[0].price / b[0].pack_size);
    // Dark chocolate drives the gift query, so keep all of it.
    const limit = sub === "dark_chocolate" ? 40 : isFood(list[0]) ? PER_KIND.food : PER_KIND.nonFood;
    // Spread picks across the price range (cheap, mid, premium) instead of only the cheapest.
    const last = products.length - 1;
    const order = [...new Set([0, last, Math.floor(last / 2), ...products.keys()])].filter((i) => i >= 0 && i <= last);
    for (const i of order) {
      if (picks.length >= limit) break;
      for (const size of products[i]) if (picks.length < limit) picks.push(size);
    }
    kept.push(...picks);
  }
  return kept;
}

/** Small deterministic hash, so the same items go out of stock on every build. */
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Matches the previous catalog's products to drafts by brand, name and size, for a catalog built before
 * the ledger existed. The first matching row wins, as the old build's de-duplication did. A product a
 * quality check now drops gets a "retired:" entry, so it's kept (out of stock) and listed in the report.
 */
function bootstrapLedger(all: Draft[], previous: Product[]): Ledger {
  const ids = new Map(previous.map((p) => [productKey(p), p.id]));
  const ledger: Ledger = {};
  for (const d of all) {
    const id = ids.get(productKey(d));
    if (!id) continue;
    ledger[d.source] = id;
    ids.delete(productKey(d));
  }
  for (const id of ids.values()) ledger[`retired:${id}`] = id;
  return ledger;
}

export type BuildInput = { rows: Row[]; supplement: SupplementItem[]; ledger: Ledger | null; previous: Product[] };

export function buildCatalog({ rows, supplement, ledger: given, previous }: BuildInput): { catalog: Product[]; ledger: Ledger; report: Report } {
  const report: Report = {
    products: 0,
    food: 0,
    non_food: 0,
    out_of_stock: 0,
    new_products: 0,
    by_category: {},
    kinds: 0,
    dropped: {},
    price_outliers: [],
    home_skips: { count: 0, examples: [] },
    retired: [],
  };
  const skips: HomeSkip[] = [];
  const all = drafts(rows, supplement, report, skips);
  const ledger: Ledger = { ...(given ?? bootstrapLedger(all, previous)) };
  const selected = select(all, new Set(all.filter((d) => ledger[d.source]).map((d) => d.source)), report);

  selected.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.sub_category.localeCompare(b.sub_category) ||
      a.name.localeCompare(b.name) ||
      a.pack_size - b.pack_size ||
      a.source.localeCompare(b.source),
  );

  // New products get the next free IDs, in catalog order.
  let next = Math.max(0, ...Object.values(ledger).map((id) => Number(id.slice(1)))) + 1;
  for (const d of selected) ledger[d.source] ??= `p${String(next++).padStart(3, "0")}`;

  // Stock carries over from the last build. New products: about 5% out, never in a kind with 2 or fewer items.
  const before = new Map(previous.map((p) => [p.id, p]));
  const kindCounts = new Map<string, number>();
  for (const d of selected) kindCounts.set(d.sub_category, (kindCounts.get(d.sub_category) ?? 0) + 1);
  const catalog: Product[] = selected.map(({ source, ...d }) => {
    const id = ledger[source];
    const old = before.get(id);
    const simulated = !((kindCounts.get(d.sub_category) ?? 0) > 2 && hash(`${d.brand}${d.name}${d.pack_size}`) % 20 === 0);
    return { id, ...d, in_stock: old ? old.in_stock : simulated };
  });

  // An ID whose row is gone stays, out of stock, so saved carts and the agent eval's carts still resolve.
  const present = new Set(catalog.map((p) => p.id));
  for (const id of new Set(Object.values(ledger))) {
    const old = before.get(id);
    if (present.has(id) || !old) continue;
    catalog.push({ ...old, in_stock: false });
    report.retired.push(id);
  }

  const parsed = CatalogSchema.safeParse(catalog);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5)));

  report.products = catalog.length;
  report.food = catalog.filter(isFood).length;
  report.non_food = catalog.length - report.food;
  report.out_of_stock = catalog.filter((p) => !p.in_stock).length;
  report.new_products = catalog.filter((p) => !before.has(p.id)).length;
  for (const p of catalog) report.by_category[p.category] = (report.by_category[p.category] ?? 0) + 1;
  report.kinds = new Set(catalog.map((p) => p.sub_category)).size;
  report.price_outliers = report.price_outliers.slice(0, 20);
  report.home_skips = { count: skips.length, examples: skips.slice(0, 25) };
  return { catalog, ledger, report };
}
