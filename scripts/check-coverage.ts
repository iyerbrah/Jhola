/**
 * Checks that data/catalog.json can serve the dishes and queries the app promises.
 * Each dish lists ingredient slots; a slot is a set of sub_categories, any one of
 * which must have an in-stock product.
 *
 * Run: npx tsx scripts/check-coverage.ts
 */
import catalogJson from "../data/catalog.json";
import { CatalogSchema } from "../lib/schema";

const catalog = CatalogSchema.parse(catalogJson);
const inStock = new Map<string, number>();
for (const p of catalog) if (p.in_stock) inStock.set(p.sub_category, (inStock.get(p.sub_category) ?? 0) + 1);

const DISHES: Record<string, string[]> = {
  // 20 common dishes
  "Paneer butter masala": ["paneer", "tomato", "onion", "cream|butter", "ginger_garlic_paste|ginger", "garam_masala|paneer_masala|masala_mix", "kasuri_methi", "chilli_powder"],
  "Dal tadka": ["toor_dal|moong_dal|masoor_dal", "tomato", "onion", "cumin", "ghee", "garlic"],
  "Chole": ["chana", "onion", "tomato", "chole_masala|masala_mix|garam_masala"],
  "Rajma chawal": ["rajma", "rice|basmati_rice", "onion", "tomato"],
  "Jeera rice": ["basmati_rice|rice", "cumin", "ghee"],
  "Veg biryani": ["basmati_rice", "onion", "curd", "biryani_masala|masala_mix|garam_masala"],
  "Chicken curry": ["chicken", "onion", "tomato", "chicken_masala|masala_mix|garam_masala"],
  "Egg curry": ["eggs", "onion", "tomato", "turmeric"],
  "Aloo jeera": ["potato", "cumin", "turmeric"],
  "Matar paneer": ["peas", "paneer", "tomato", "onion"],
  "Palak paneer": ["leafy_vegetables", "paneer", "garlic"],
  "Khichdi": ["moong_dal", "rice", "ghee", "turmeric"],
  "Sambar rice": ["toor_dal", "sambar_masala|masala_mix", "tomato", "rice"],
  "Rotis": ["atta"],
  "Kadhi": ["besan", "curd"],
  "Sooji halwa": ["sooji", "ghee", "sugar"],
  "Rice kheer": ["rice|basmati_rice", "milk", "sugar", "cashews|almonds|raisins"],
  "Veg pulao": ["basmati_rice", "peas", "ghee"],
  "Masala chai": ["tea", "milk", "sugar"],
  "Lemon rice": ["rice", "lemon", "peanuts", "curry_leaves", "mustard"],
  // 5 breakfasts
  "Poha": ["poha", "onion", "peanuts", "curry_leaves"],
  "Masala dosa": ["dosa_batter", "potato", "onion"],
  "Aloo paratha": ["atta", "potato", "curd|butter"],
  "Upma": ["sooji|upma_mix", "mustard"],
  "Bread omelette": ["bread", "eggs", "onion"],
  // other example queries
  "Movie night snacks": ["chips|nachos", "popcorn", "namkeen", "soft_drink|juice"],
  "High-protein week": ["paneer", "eggs", "chana|rajma|moong_dal", "oats", "peanuts|almonds"],
  "Green tea selection": ["green_tea"],
  "Fruit basket": ["banana", "apple", "citrus", "papaya|pomegranate|grapes|guava"],
  "Fish curry": ["fish", "onion", "tomato", "coconut_oil|cooking_oil"],
  "Mutton curry": ["mutton", "onion", "curd", "meat_masala|masala_mix|garam_masala"],
  "Pav bhaji": ["bread", "potato", "cauliflower", "capsicum", "peas", "butter", "pav_bhaji_masala"],
  "Salad": ["cucumber", "lettuce", "tomato", "lemon"],
};

let failed = 0;
for (const [dish, slots] of Object.entries(DISHES)) {
  const missing = slots.filter((slot) => !slot.split("|").some((s) => (inStock.get(s) ?? 0) > 0));
  if (missing.length) failed++;
  console.log(`${missing.length ? "✗" : "✓"} ${dish}${missing.length ? `  (missing: ${missing.join(", ")})` : ""}`);
}

// The gift query needs 4 distinct dark chocolates at three different price levels.
const dark = catalog.filter((p) => p.in_stock && p.tags.includes("dark_chocolate"));
const withCocoa = dark.filter((p) => p.tags.some((t) => t.startsWith("cocoa_")));
const darkOk = dark.length >= 12 && withCocoa.length >= 8;
if (!darkOk) failed++;
console.log(`${darkOk ? "✓" : "✗"} Dark chocolate gift: ${dark.length} in stock, ${withCocoa.length} with cocoa % (need 12 and 8)`);

const oos = catalog.filter((p) => !p.in_stock).length;
console.log(`\n${catalog.length} products, ${oos} out of stock (${((oos / catalog.length) * 100).toFixed(1)}%)`);
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("All coverage checks passed");
