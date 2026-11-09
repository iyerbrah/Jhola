/**
 * The browser side of the cart editor agent: builds the /api/agent request, reads the streamed
 * JSON lines, and describes the result for the chat. No React here, so it's unit-tested.
 */
import type { CatalogIndex } from "../catalog";
import { cartTotal } from "../cartState";
import type { AgentStreamEvent } from "./api";
import type { AgentCart } from "./carts";
import type { CartChange } from "./changes";
import type { ChatTurn } from "./prompt";

export type AgentDone = Extract<AgentStreamEvent, { type: "done" }>;
export type AgentOutcome = { kind: "done"; result: AgentDone } | { kind: "error"; error: string; status: number; retryAfter?: number };

/** The request body: product IDs, quantities and flags only. The server takes everything else from the catalog. */
export function agentRequest(carts: AgentCart[], active: number, message: string, history: ChatTurn[]) {
  return {
    carts: carts.map((c) => ({
      name: c.name,
      reason: c.reason,
      items: c.items.map((it) => ({ product_id: it.product_id, qty: it.qty, optional: it.optional, included: it.included, note: it.note })),
      requirements: c.requirements,
    })),
    active,
    message,
    history: history.slice(-6),
  };
}

/** Reads a streamed turn: calls onStatus for each progress line, and resolves with the result. */
export async function readAgentStream(res: Response, onStatus: (text: string) => void): Promise<AgentOutcome> {
  if (!res.body) return { kind: "error", error: "No reply from Jhola. Please try again.", status: res.status };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line: string): AgentOutcome | null => {
    if (!line.trim()) return null;
    let e: AgentStreamEvent;
    try {
      e = JSON.parse(line);
    } catch {
      return null;
    }
    if (e.type === "status") onStatus(e.text);
    else if (e.type === "done") return { kind: "done", result: e };
    else if (e.type === "error") return { kind: "error", error: e.error, status: 200 };
    return null;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const outcome = handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (outcome) return outcome;
    }
  }
  return handle(buffer) ?? { kind: "error", error: "The reply was cut off, so your carts weren't changed. Please try again.", status: 200 };
}

/** Sends one turn and reads its stream. Input and rate-limit errors come back as an "error" outcome. */
export async function sendAgentTurn(
  body: ReturnType<typeof agentRequest>,
  { onStatus, signal, fetchImpl = fetch }: { onStatus: (text: string) => void; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<AgentOutcome> {
  let res: Response;
  try {
    res = await fetchImpl("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch {
    return { kind: "error", error: "Couldn't reach Jhola. Check your connection and try again.", status: 0 };
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; retry_after?: number };
    return { kind: "error", error: err.error ?? "Something went wrong. Please try again.", status: res.status, retryAfter: err.retry_after };
  }
  return readAgentStream(res, onStatus);
}

/** One line per changed cart: "−Chicken Curry Cut ×2, +Fresh Paneer ×4, Basmati Rice 1 → 2". */
export function describeChange(c: CartChange): string {
  const parts = [
    ...c.removed.map((r) => `−${r.name}${r.qty > 1 ? ` ×${r.qty}` : ""}`),
    ...c.added.map((a) => `+${a.name}${a.qty > 1 ? ` ×${a.qty}` : ""}`),
    ...c.qty_changed.map((q) => `${q.name} ${q.from} → ${q.to}`),
  ];
  return parts.join(", ");
}

/** Requirement changes as a short sentence: "Now vegetarian · now needs paneer". */
export function describeRequirements(c: CartChange): string {
  const text = c.requirements.join(" · ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

/**
 * Suggestion chips for a cart, worked out from what's in it: "Make it vegetarian" only if something
 * isn't veg, and a budget a fair step below the current total.
 */
export function suggestionsFor(cart: AgentCart, index: CatalogIndex): string[] {
  const ordered = cart.items.filter((it) => it.included);
  const chips: string[] = [];
  if (cart.requirements.diet == null && ordered.some((it) => !index.get(it.product_id)?.tags.includes("veg"))) chips.push("Make it vegetarian");
  const target = Math.floor((cartTotal(cart) * 0.8) / 50) * 50;
  if (target >= 100) chips.push(`Keep it under ₹${target}`);
  chips.push("Make it cheaper", "Add something for dessert");
  return chips.slice(0, 4);
}

/** Earlier chat as model history: each finished turn's message and reply. */
export function chatHistory(turns: { message: string; reply?: string }[]): ChatTurn[] {
  return turns.flatMap((t) => (t.reply ? [{ role: "user" as const, content: t.message }, { role: "assistant" as const, content: t.reply }] : [])).slice(-6);
}
