/**
 * Try the shopping agent against the real model: each argument is one message in the same chat.
 * Prints what it understood, the cart with why each line is there, the checklist, the end note,
 * the change list for edits, and the time, steps and cost of each turn.
 *
 * Run: npm run try:chat -- "stuff for pasta night for 4, vegetarian, around ₹600" "make it 6 people"
 * Costs about ₹0.3-1 ($0.004-0.01) per message on gpt-5.4-mini.
 */
import { createMemorySearch } from "../lib/search";
import { catalog, catalogIndex } from "../lib/catalog";
import { describeDiff } from "../lib/cart/diff";
import { runChatTurn, type ChatTurn } from "../lib/chat/loop";
import { openAiChatModel } from "../lib/chat/model";
import { emptySession } from "../lib/chat/session";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

async function main() {
  const messages = process.argv.slice(2);
  if (!messages.length) messages.push("stuff for pasta night for 4, vegetarian, around ₹600");
  const deps = {
    model: openAiChatModel,
    products: catalog,
    index: catalogIndex,
    search: createMemorySearch(catalog),
    kinds: new Set(catalog.filter((p) => p.in_stock).map((p) => p.sub_category)),
    onEvent: (e: { type: string; text?: string; brief?: { summary: string } }) => {
      if (e.type === "status") console.log(`  … ${e.text}`);
      if (e.type === "brief") console.log(`  ⟶ ${e.brief!.summary}`);
    },
    log: () => {},
  };
  let session = emptySession();
  const history: ChatTurn[] = [];
  for (const message of messages) {
    console.log(`\n> ${message}`);
    const r = await runChatTurn({ session, message, history }, deps);
    console.log(`\n${r.status === "done" ? "✓" : r.status === "confirm" ? "?" : "✗"} ${r.reply}`);
    if (r.question) console.log(`  ? ${r.question.question} [${r.question.options.join(" / ")}]`);
    for (const l of r.cart.lines) {
      console.log(`  ${l.counted ? " " : "○"} ${l.product.brand} ${l.product.name} ${l.product.pack_label} × ${l.packs} = ₹${l.line_total}  · ${l.why}${l.substitution ? "  (swapped: out of stock)" : ""}`);
    }
    console.log(`  Total ₹${r.cart.total}`);
    console.log(`  ${r.checks.map((c) => `${c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✗"} ${c.label}`).join(" · ")}`);
    for (const n of r.note) console.log(`  note: ${n}`);
    if (r.diff && history.length) console.log(`  changes: ${describeDiff(r.diff) || "none"}`);
    if (r.pending) console.log(`  waiting for confirmation: ${r.pending.reason}`);
    console.log(`  ${(r.meta.latency_ms / 1000).toFixed(1)} s · ${r.meta.model_calls} model + ${r.meta.tool_calls} tool calls · ₹${r.meta.cost_inr ?? "?"} ($${r.meta.cost_usd?.toFixed(4) ?? "?"}) · ended by ${r.meta.finished_by ?? r.stop_reason}`);
    session = r.session;
    history.push({ role: "user", content: message }, { role: "assistant", content: r.reply });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
