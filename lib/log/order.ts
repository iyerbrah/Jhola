/**
 * "I'm ready to order": the shopper's yes to the cart, and Jhola's success event.
 *
 * POST /api/order        { order_id, number, session_id, request_id?, session, messages? }
 *   The cart is solved again here from the session, so the total and lines stored are the server's own,
 *   whatever the browser says. 204 when saved, 400 for bad input or an empty cart, 429, 503.
 * POST /api/order/rating { order_id, stars: 1-5, comment?, name? }
 *   The stars, comment and name the shopper leaves on the thank-you popup. They're shown on the public
 *   History page, so phone numbers, emails and links are masked first. Rating again replaces it.
 *   204 when saved, 400, 404 for an unknown order, 429, 503.
 */
import { z } from "zod";
import { catalog, catalogIndex, type CatalogIndex } from "../catalog";
import { solveSession } from "../chat/loop";
import { parseSession } from "../chat/session";
import { clientIp, json } from "../http";
import { createMemoryLimiter, createUpstashLimiter, redisFromEnv, type Limiter } from "../ratelimit";
import { defaultRequestLog, maskPublic, type RequestLog } from "./requestLog";
import type { Product } from "../schema";
import { visitorId } from "../visitor";

export const OrderRequestSchema = z.object({
  order_id: z.string().uuid(),
  number: z.string().regex(/^JH-\d{6}$/),
  session_id: z.string().uuid(),
  request_id: z.string().uuid().optional(),
  session: z.unknown(),
  /** The browser's count of chat messages: used only if the log can't be read. */
  messages: z.number().int().min(0).max(500).optional(),
});

export const RatingRequestSchema = z.object({
  order_id: z.string().uuid(),
  stars: z.number().int().min(1, "Pick 1 to 5 stars").max(5, "Pick 1 to 5 stars"),
  comment: z.string().max(1000, "Keep the comment under 1,000 characters").optional(),
  name: z.string().max(60, "Keep the name under 60 characters").optional(),
});

export type OrderDeps = { limiter: Limiter; requestLog: RequestLog; products: Product[]; index: CatalogIndex };

let defaults: OrderDeps | null = null;
function defaultOrderDeps(): OrderDeps {
  if (defaults) return defaults;
  const redis = redisFromEnv();
  const config = { perHour: 60, perDay: 5000 };
  const limitsOn = process.env.NODE_ENV === "production" || process.env.RATE_LIMIT_IN_DEV === "1";
  defaults = {
    limiter: !limitsOn ? { check: async () => ({ ok: true }) } : redis ? createUpstashLimiter(redis, config, "acb:order:rl") : createMemoryLimiter(config),
    requestLog: defaultRequestLog(),
    products: catalog,
    index: catalogIndex,
  };
  return defaults;
}

async function body(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > 200_000) throw new Error("too large");
  return req.json();
}

async function limited(limiter: Limiter, req: Request): Promise<Response | null> {
  try {
    const limit = await limiter.check(clientIp(req));
    if (!limit.ok) return json({ error: "Too many tries in a short time.", retry_after: limit.retryAfter }, 429);
  } catch {
    // If the limiter is down, let it through: it costs nothing.
  }
  return null;
}

/** Trims, masks, and turns an empty string into null. */
const clean = (s: string | undefined) => {
  const t = s?.trim().replace(/\s+/g, " ");
  return t ? maskPublic(t) : null;
};

export async function handleOrder(req: Request, deps: OrderDeps = defaultOrderDeps()): Promise<Response> {
  let raw: unknown;
  try {
    raw = await body(req);
  } catch {
    return json({ error: "Send JSON with order_id, number, session_id and session." }, 400);
  }
  const parsed = OrderRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid order" }, 400);
  const o = parsed.data;
  const s = parseSession(o.session);
  if (!s.ok) return json({ error: s.error }, 400);
  const blocked = await limited(deps.limiter, req);
  if (blocked) return blocked;

  const solved = solveSession(s.session, deps);
  const lines = solved.cart.lines.filter((l) => l.counted);
  if (!lines.length) return json({ error: "There's nothing in the cart to order." }, 400);

  try {
    let messages = o.messages ?? 0;
    try {
      messages = await deps.requestLog.countMessages(o.session_id);
    } catch {
      // Keep the browser's count.
    }
    await deps.requestLog.placeOrder({
      id: o.order_id,
      number: o.number,
      session_id: o.session_id,
      request_id: o.request_id ?? null,
      visitor: visitorId(clientIp(req)),
      total: solved.cart.total,
      items: lines.length,
      lines: lines.map((l) => ({ product_id: l.product.id, qty: l.packs, price: l.product.price })),
      failed: solved.checks.filter((c) => c.status === "fail").map((c) => c.label),
      messages,
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[order] couldn't save an order:", err instanceof Error ? err.message : err);
    return json({ error: "Couldn't save that right now." }, 503);
  }
}

export async function handleOrderRating(req: Request, deps: OrderDeps = defaultOrderDeps()): Promise<Response> {
  let raw: unknown;
  try {
    raw = await body(req);
  } catch {
    return json({ error: "Send JSON with order_id and stars." }, 400);
  }
  const parsed = RatingRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid rating" }, 400);
  const r = parsed.data;
  const blocked = await limited(deps.limiter, req);
  if (blocked) return blocked;
  try {
    const result = await deps.requestLog.rateOrder({ order_id: r.order_id, stars: r.stars, comment: clean(r.comment), name: clean(r.name) });
    if (result === "unknown") return json({ error: "That order isn't in the log." }, 404);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[order] couldn't save a rating:", err instanceof Error ? err.message : err);
    return json({ error: "Couldn't save that right now." }, 503);
  }
}
