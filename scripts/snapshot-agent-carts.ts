/**
 * Saves real cart-builder answers as the agent eval's starting carts (evals/agent/carts.json),
 * so every eval run starts from the same carts without paying to build them again.
 * Product IDs and quantities only: prices and names come from the catalog when the eval loads them.
 *
 * Run: npm run eval:agent:snapshot     (about $0.12; only when the starting carts should change)
 */
import fs from "node:fs";
import path from "node:path";
import { buildCarts } from "../lib/buildCarts";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

/** Name → request. The names are what scenarios refer to. */
const STARTING_CARTS: Record<string, string> = {
  chicken_biryani: "chicken biryani for 4",
  paneer_butter_masala: "paneer butter masala for 4",
  monthly_groceries: "monthly groceries for a couple under 3000",
  dark_chocolate_gift: "gift an assortment of 4 dark chocolate variants, budget 1000 rs",
  pav_bhaji: "pav bhaji for 5",
  egg_curry: "egg curry for 3",
  biryani_and_cleaning: "chicken biryani for 4, plus dishwash liquid and floor cleaner",
};

async function main() {
  const out: Record<string, unknown> = {};
  for (const [name, query] of Object.entries(STARTING_CARTS)) {
    const res = await buildCarts(query);
    if (res.variants.length !== 3) throw new Error(`"${query}" gave ${res.variants.length} carts; run again`);
    out[name] = {
      query,
      carts: res.variants.map((v) => ({
        name: v.name,
        reason: v.reason,
        items: v.items.map((it) => ({ product_id: it.product_id, qty: it.qty, optional: it.optional, included: !it.optional, note: it.note })),
        requirements: res.requirements,
      })),
    };
    console.log(`${name}: ${res.variants.map((v) => `${v.name} ₹${v.total} (${v.items.length} items)`).join(", ")}`);
  }
  const file = path.resolve(__dirname, "../evals/agent/carts.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`Saved ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
