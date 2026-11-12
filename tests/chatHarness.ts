/**
 * A scripted model for the shopping agent's tests. Each scripted step is a list of tool calls (or an
 * error); like the real model it streams, handing each call to `onCall` before the step returns.
 */
import { createMemorySearch } from "@/lib/search";
import { runChatTurn, type ChatDeps, type ChatTurnInput } from "@/lib/chat/loop";
import type { ChatInputItem, ChatModel, ModelStep } from "@/lib/chat/model";
import type { ChatEvent } from "@/lib/chat/tools";
import { emptySession } from "@/lib/chat/session";
import type { Session } from "@/lib/cart/types";
import { index, products } from "./cartFixtures";

export type Scripted = ModelStep | Error;

let callId = 0;
/** One model step that calls these tools, in order. */
export function step(...calls: [string, Record<string, unknown>][]): ModelStep {
  return {
    calls: calls.map(([name, args]) => ({ call_id: `c${++callId}`, name, arguments: JSON.stringify(args) })),
    text: "",
    usage: { input_tokens: 1000, cached_tokens: 800, output_tokens: 100 },
    model: "gpt-5.4-mini",
    replay: [],
  };
}

/** update_cart arguments that change the brief (and no needs unless given). */
export const brief = (o: Record<string, unknown> = {}) => ({
  summary: "Pasta night, 4 people",
  shopping_list: null,
  people: 4,
  budget_inr: null,
  diet: null,
  quality: null,
  add_rules: [],
  remove_rules: [],
  assumptions: null,
  needs: [],
  remove: [],
  done: false,
  ...o,
});

export const addNeed = (id: string, kind: string, amount: number, unit: string, o: Record<string, unknown> = {}) => ({
  id,
  group: "pasta",
  label: id[0].toUpperCase() + id.slice(1),
  kind,
  amount,
  unit,
  per_person: true,
  role: "core",
  suggestion: false,
  count: null,
  prefer: null,
  why: "for the sauce",
  confidence: "sure",
  ...o,
});

/** update_cart arguments that change needs only: `add` needs are upserted by id. */
export const needs = (o: { add?: unknown[]; remove?: string[]; done?: boolean } = {}) => ({
  summary: null,
  shopping_list: null,
  people: null,
  budget_inr: null,
  diet: null,
  quality: null,
  add_rules: [],
  remove_rules: [],
  assumptions: null,
  needs: o.add ?? [],
  remove: o.remove ?? [],
  done: o.done ?? false,
});

/** A whole first turn: the brief and every need in one call. */
export const build = (o: Record<string, unknown> = {}) => brief({ needs: pastaAdds(), done: true, ...o });

export const pastaAdds = () => [
  addNeed("pasta", "pasta", 100, "g", { role: "main", prefer: "penne" }),
  addNeed("tomato", "tomato", 125, "g"),
  addNeed("cream", "cream", 30, "ml", { prefer: "fresh cream", confidence: "guess" }),
  addNeed("cheese", "cheese", 25, "g"),
  addNeed("garlic", "garlic", 15, "g", { per_person: false }),
];

export function scripted(script: Scripted[]): ChatModel & { sent: ChatInputItem[][] } {
  const sent: ChatInputItem[][] = [];
  return {
    sent,
    async next({ input, onCall }) {
      sent.push(structuredClone(input));
      const s = script.shift();
      if (!s) throw new Error("the script ran out");
      if (s instanceof Error) throw s;
      for (const c of s.calls) onCall?.(c);
      return s;
    },
  };
}

export const kinds = new Set(products.filter((p) => p.in_stock).map((p) => p.sub_category));
export const search = createMemorySearch(products);

export function setup(script: Scripted[], extra: Partial<ChatDeps> = {}) {
  const model = scripted(script);
  const events: ChatEvent[] = [];
  const logs: Record<string, unknown>[] = [];
  // Close calls are off unless a test turns them on: most scripts are about other things.
  const deps: ChatDeps = { model, products, index, search, kinds, onEvent: (e) => events.push(e), log: (l) => logs.push(l), ...extra, limits: { maxOffers: 0, ...extra.limits } };
  return { model, events, logs, deps, turn: (message: string, session: Session = emptySession(), history: ChatTurnInput["history"] = []) => runChatTurn({ session, message, history }, deps) };
}

/** Tool outputs sent back to the model, in order. */
export function toolResults(input: ChatInputItem[]): string[] {
  return input.flatMap((it) => (it.kind === "tool_result" ? [it.output] : []));
}
