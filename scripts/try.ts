/**
 * Runs queries through the real pipeline and prints the carts.
 *
 * Run: npm run try                      (the three example queries)
 *      npm run try -- "poha for 3"      (your own query)
 */
import { buildCarts } from "../lib/buildCarts";

// Same files Next.js reads; .env.local wins. Missing files are fine.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {}
}

const EXAMPLES = [
  "want to cook paneer butter masala for 4",
  "want to cook some tasty indian breakfast for 2",
  "gift an assortment of 4 dark chocolate variants, budget 1000 rs",
];

async function main() {
  const queries = process.argv.slice(2).length ? [process.argv.slice(2).join(" ")] : EXAMPLES;
  let failures = 0;
  for (const q of queries) {
    console.log(`\n=== ${q}`);
    try {
      const res = await buildCarts(q);
      const m = res.meta;
      console.log(`status: ${res.status} · ${m.latency_ms} ms · ${m.model} · repaired: ${m.repaired} · tokens in ${m.input_tokens} (cached ${m.cached_tokens}) / out ${m.output_tokens}`);
      if (res.message) console.log(`message: ${res.message}`);
      if (res.assumptions.length) console.log(`assumptions: ${res.assumptions.join("; ")}`);
      if (res.suggestions.length) console.log(`suggestions: ${res.suggestions.join(" | ")}`);
      for (const v of res.variants) {
        console.log(`\n  ${v.name} — ₹${v.total}  (${v.reason})`);
        for (const it of v.items) {
          const opt = it.optional ? " [optional]" : "";
          console.log(`    ${it.qty} × ${it.brand} ${it.name} ${it.pack_label} @ ₹${it.price} = ₹${it.line_total}${opt}${it.note ? `  — ${it.note}` : ""}`);
        }
      }
    } catch (err) {
      failures++;
      console.error(`  FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failures) process.exit(1);
}

main();
