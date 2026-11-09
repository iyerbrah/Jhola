/**
 * POST /api/agent: one cart editor turn.
 *
 * The browser sends its carts, the cart it's looking at, the message and recent chat. Input errors
 * and rate limits come back as plain JSON with a 4xx status. A valid turn streams newline-delimited
 * JSON: {"type":"status","text":"Searching for paneer"} lines while it works, then one
 * {"type":"done", ...} with the new carts, the change list and the reply (or {"type":"error"}).
 */
import { z } from "zod";
import { clientIp } from "../api";
import { catalog, catalogIndex, type CatalogIndex } from "../catalog";
import { createMemoryLimiter, createUpstashLimiter, redisFromEnv, type LimitConfig, type Limiter } from "../ratelimit";
import { CartsInputSchema, repriceCarts, type RepriceNote } from "./carts";
import { runAgentTurn, type AgentEvent, type AgentTurnInput, type AgentTurnResult } from "./loop";
import { openAiAgentModel } from "./model";
import { createMemorySearch } from "./search";

/** Three full carts plus recent chat stay well under this. */
export const MAX_BODY_BYTES = 64 * 1024;

export const AgentRequestSchema = z.object({
  carts: CartsInputSchema,
  /** 0-based index of the cart the shopper is looking at. */
  active: z.number().int().min(0).max(2),
  message: z.string().trim().min(1, "Type what you'd like to change").max(300, "That's too long (max 300 characters)"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(500) }))
    .max(12)
    .default([]),
});

export type AgentStreamEvent =
  | AgentEvent
  | ({ type: "done"; notes: RepriceNote[] } & Pick<AgentTurnResult, "status" | "stop_reason" | "reply" | "carts" | "changes"> & {
        meta: Pick<AgentTurnResult["meta"], "trace_id" | "latency_ms" | "model_calls" | "tool_calls">;
      })
  | { type: "error"; error: string };

export type AgentApiDeps = {
  limiter: Limiter;
  index: CatalogIndex;
  run: (input: AgentTurnInput, opts: { onEvent: (e: AgentEvent) => void; signal: AbortSignal }) => Promise<AgentTurnResult>;
};

const noLimit: Limiter = { check: async () => ({ ok: true }) };

export function agentLimitConfigFromEnv(): LimitConfig {
  const num = (v: string | undefined, fallback: number) => (v && Number(v) > 0 ? Number(v) : fallback);
  // A turn costs about a quarter of a cart build, so the agent gets more turns than builds.
  return { perHour: num(process.env.AGENT_RATE_LIMIT_PER_HOUR, 30), perDay: num(process.env.AGENT_DAILY_CAP, 600) };
}

let defaults: AgentApiDeps | null = null;

/** Real dependencies: Upstash limits in production (in memory without Upstash), none on your own machine. */
export function defaultAgentDeps(): AgentApiDeps {
  if (defaults) return defaults;
  const redis = redisFromEnv();
  const config = agentLimitConfigFromEnv();
  const limitsOn = process.env.NODE_ENV === "production" || process.env.RATE_LIMIT_IN_DEV === "1";
  const search = createMemorySearch(catalog);
  defaults = {
    // Its own keys, so agent turns don't use up the shopper's cart builds.
    limiter: !limitsOn ? noLimit : redis ? createUpstashLimiter(redis, config, "acb:agent:rl") : createMemoryLimiter(config),
    index: catalogIndex,
    run: (input, { onEvent, signal }) => runAgentTurn(input, { model: openAiAgentModel, index: catalogIndex, products: catalog, search, onEvent, signal }),
  };
  return defaults;
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function handleAgentTurn(req: Request, deps: AgentApiDeps = defaultAgentDeps()): Promise<Response> {
  // 1. Input
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "That request is too large." }, 413);
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "That request is too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Send JSON with carts, active, message and history." }, 400);
  }
  const parsed = AgentRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ error: issue?.path[0] === "message" ? issue.message : `Invalid request: ${issue?.path.join(".") || "body"} ${issue?.message ?? ""}`.trim() }, 400);
  }
  const { carts: cartInput, active, message, history } = parsed.data;
  if (active >= cartInput.length) return json({ error: `Invalid request: active is ${active} but there ${cartInput.length === 1 ? "is 1 cart" : `are ${cartInput.length} carts`}` }, 400);

  // 2. Rate limit (before anything that costs money). If Redis is down, let the turn through.
  try {
    const limit = await deps.limiter.check(clientIp(req));
    if (!limit.ok) {
      const error = limit.scope === "daily" ? "The cart helper has reached its daily limit. Please try again tomorrow." : "Too many changes in a short time. Please try again later.";
      return json({ error, retry_after: limit.retryAfter }, 429, { "Retry-After": String(limit.retryAfter) });
    }
  } catch (err) {
    console.error("[agent] rate limiter failed:", err instanceof Error ? err.message : err);
  }

  // 3. The turn, streamed. Carts are rebuilt from the catalog: the browser's prices never count.
  const { carts, notes } = repriceCarts(cartInput, deps.index);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // The shopper left; the turn is being cancelled.
        }
      };
      try {
        const r = await deps.run({ carts, active, message, history }, { onEvent: send, signal: req.signal });
        const { trace_id, latency_ms, model_calls, tool_calls } = r.meta;
        send({ type: "done", status: r.status, stop_reason: r.stop_reason, reply: r.reply, carts: r.carts, changes: r.changes, notes, meta: { trace_id, latency_ms, model_calls, tool_calls } });
      } catch (err) {
        console.error("[agent] turn failed:", err);
        send({ type: "error", error: "Something went wrong, so your carts weren't changed. Please try again." });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Tells nginx to pass each line on as it's written, instead of holding the response.
      "X-Accel-Buffering": "no",
    },
  });
}
