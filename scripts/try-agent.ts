/**
 * Try the cart editor agent against the real model: builds carts for a request, then runs each
 * follow-up message as an agent turn on the cart you're "looking at" (cart 1), printing the steps,
 * the reply, what changed and the cost.
 *
 * Run: npm run try:agent -- "chicken biryani for 4" "make it vegetarian" "cheaper please"
 * Costs about $0.02 for the carts plus about $0.01 per message.
 */
import { CartsInputSchema, repriceCarts } from "../lib/agent/carts";
import { runAgentTurn } from "../lib/agent/loop";
import { openAiAgentModel } from "../lib/agent/model";
import type { ChatTurn } from "../lib/agent/prompt";
import { createMemorySearch } from "../lib/agent/search";
import { cartView } from "../lib/agent/tools";
import { buildCarts } from "../lib/buildCarts";
import { catalog, catalogIndex } from "../lib/catalog";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

async function main() {
  const [query = "chicken biryani for 4", ...messages] = process.argv.slice(2);
  if (!messages.length) messages.push("make it vegetarian");

  console.log(`Building carts for "${query}"…`);
  const res = await buildCarts(query);
  const input = res.variants.map((v) => ({ name: v.name, reason: v.reason, items: v.items.map((it) => ({ ...it, included: !it.optional })), requirements: res.requirements }));
  let carts = repriceCarts(CartsInputSchema.parse(input), catalogIndex).carts;
  console.log(carts.map((c, i) => cartView(c, i, catalogIndex, 0)).join("\n\n"));

  const deps = { model: openAiAgentModel, index: catalogIndex, products: catalog, search: createMemorySearch(catalog), onEvent: (e: { text: string }) => console.log(`  … ${e.text}`), log: () => {} };
  const history: ChatTurn[] = [];
  for (const message of messages) {
    console.log(`\n> ${message}`);
    const turn = await runAgentTurn({ carts, active: 0, message, history }, deps);
    console.log(`\n${turn.status === "done" ? "✓" : "✗"} ${turn.reply}`);
    for (const c of turn.changes) {
      const parts = [
        ...c.removed.map((r) => `−${r.name} ×${r.qty}`),
        ...c.added.map((a) => `+${a.name} ×${a.qty}`),
        ...c.qty_changed.map((q) => `${q.name} ${q.from}→${q.to}`),
        ...c.requirements,
      ];
      console.log(`  Cart ${c.cart}: ${parts.join(", ")} · ₹${c.total_before} → ₹${c.total_after}`);
    }
    const m = turn.meta;
    console.log(`  ${turn.stop_reason} · ${m.model_calls} model calls, ${m.tool_calls} tool calls · ${(m.latency_ms / 1000).toFixed(1)} s · $${m.cost_usd?.toFixed(4) ?? "?"}`);
    carts = turn.carts;
    history.push({ role: "user", content: message }, { role: "assistant", content: turn.reply });
  }
  console.log(`\nCart 1 now:\n${cartView(carts[0], 0, catalogIndex, 0)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
