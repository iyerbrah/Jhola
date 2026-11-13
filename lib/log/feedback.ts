/**
 * POST /api/feedback: a shopper's 👍 or 👎 on an agent reply ("Helpful?").
 *
 * Body: { request_id, target: "reply", rating: 1 | -1 | 0 }. (target "cart" with cart 0-2 is from the first
 * version's 3-cart builder; votes on those old carts are still accepted.)
 * Rating 0 takes the vote back. Each visitor has one vote per cart or reply; voting again changes it.
 * Answers 204 when saved, 400 for bad input, 404 for an unknown request, 429 when rate-limited.
 */
import { z } from "zod";
import { clientIp, json } from "../http";
import { createMemoryLimiter, createUpstashLimiter, redisFromEnv, type Limiter } from "../ratelimit";
import { defaultRequestLog, type RequestLog } from "./requestLog";
import { visitorId } from "../visitor";

export const FeedbackRequestSchema = z
  .object({
    request_id: z.string().uuid(),
    target: z.enum(["cart", "reply"]),
    cart: z.number().int().min(0).max(2).optional(),
    rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  })
  .refine((f) => f.target === "reply" || f.cart !== undefined, { message: "Say which cart (0-2) this is about", path: ["cart"] });

export type FeedbackDeps = { limiter: Limiter; requestLog: RequestLog };

let defaults: FeedbackDeps | null = null;

function defaultFeedbackDeps(): FeedbackDeps {
  if (defaults) return defaults;
  const redis = redisFromEnv();
  const config = { perHour: 60, perDay: 2000 };
  const limitsOn = process.env.NODE_ENV === "production" || process.env.RATE_LIMIT_IN_DEV === "1";
  defaults = {
    limiter: !limitsOn ? { check: async () => ({ ok: true }) } : redis ? createUpstashLimiter(redis, config, "acb:fb:rl") : createMemoryLimiter(config),
    requestLog: defaultRequestLog(),
  };
  return defaults;
}

export async function handleFeedback(req: Request, deps: FeedbackDeps = defaultFeedbackDeps()): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON with request_id, target, cart and rating." }, 400);
  }
  const parsed = FeedbackRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid feedback" }, 400);
  const f = parsed.data;

  const ip = clientIp(req);
  try {
    const limit = await deps.limiter.check(ip);
    if (!limit.ok) return json({ error: "Too many votes in a short time.", retry_after: limit.retryAfter }, 429);
  } catch {
    // If the limiter is down, let the vote through: it costs nothing.
  }

  try {
    const result = await deps.requestLog.rate({
      request_id: f.request_id,
      target: f.target,
      cart_position: f.target === "cart" ? (f.cart ?? 0) : -1,
      rating: f.rating,
      visitor: visitorId(ip),
    });
    if (result === "unknown") return json({ error: "That answer isn't in the log." }, 404);
    if (result === "mismatch") return json({ error: f.target === "cart" ? "That isn't one of a build's carts." : "That isn't an agent reply." }, 400);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[feedback] couldn't save a vote:", err instanceof Error ? err.message : err);
    return json({ error: "Couldn't save that right now." }, 503);
  }
}
