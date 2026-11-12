/**
 * A chat turn as a request-log record. Turns are stored with kind "agent" (the table's existing kind),
 * the cart before and after at position 0, and every model and tool step as trace steps.
 */
import { catalog } from "../catalog";
import type { CartRecord, RequestRecord, StepRecord } from "../requestLog";
import type { Cart } from "../cart/types";
import type { ChatTurnResult } from "./loop";

export function cartRecord(role: CartRecord["role"], cart: Cart, name: string): CartRecord {
  return {
    role,
    position: 0,
    name: name.slice(0, 120) || "Cart",
    reason: "",
    total: cart.total,
    items: cart.lines.map((l) => ({ product_id: l.product.id, qty: l.packs, price: l.product.price, optional: !l.counted, included: l.counted, note: l.why })),
  };
}

export function chatRecord(a: {
  id: string;
  parent_id: string | null;
  session_id: string;
  visitor: string;
  message: string;
  before: Cart;
  result: ChatTurnResult;
  cached: boolean;
}): RequestRecord {
  const r = a.result;
  const steps: StepRecord[] = r.meta.steps.map((s) => ({ ...s, name: s.name.slice(0, 80) }));
  const changed = r.status === "done" && (r.diff.added.length || r.diff.removed.length || r.diff.swapped.length || r.diff.packs.length);
  return {
    id: a.id,
    kind: "agent",
    parent_id: a.parent_id,
    visitor: a.visitor,
    query: a.message,
    status: r.status,
    stop_reason: r.stop_reason,
    cached: a.cached,
    model: r.meta.model || null,
    latency_ms: r.meta.latency_ms,
    input_tokens: r.meta.input_tokens,
    cached_tokens: r.meta.cached_tokens,
    output_tokens: r.meta.output_tokens,
    cost_usd: a.cached ? 0 : r.meta.cost_usd,
    model_calls: r.meta.model_calls,
    tool_calls: r.meta.tool_calls,
    catalog_size: catalog.length,
    meta: {
      chat: true,
      session_id: a.session_id,
      reply: r.reply,
      question: r.question,
      summary: r.session.brief.summary,
      checks: r.checks,
      diff: r.diff,
      note: r.note,
      confirm: r.pending?.reason ?? null,
      finished_by: r.meta.finished_by ?? null,
    },
    carts: [cartRecord("before", a.before, r.session.brief.summary), ...(changed ? [cartRecord("after", r.cart, r.session.brief.summary)] : [])],
    steps: a.cached ? [] : steps,
  };
}
