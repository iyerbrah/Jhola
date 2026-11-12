/**
 * The shopping agent's HTTP endpoints:
 *
 * - POST /api/chat: one turn, streamed as newline-delimited JSON. Progress lines while it works
 *   ({"type":"status"}, then "brief", "needs" and "cart" as each is ready), then one {"type":"done"}.
 * - POST /api/solve: a tap instead of a message (chips, ticks, swaps, confirm). No model, instant.
 * - POST /api/share: a snapshot of the session behind a short link.
 *
 * Input errors and rate limits come back as plain JSON with a 4xx status. The browser's session is
 * untrusted: it's parsed, and the cart is always solved again here from the catalog.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Redis } from "@upstash/redis";
import { catalog, catalogIndex, type CatalogIndex } from "../catalog";
import { clientIp, json } from "../http";
import { modelName } from "../llm";
import { createMemoryLimiter, createUpstashLimiter, redisFromEnv, type LimitConfig, type Limiter } from "../ratelimit";
import { defaultRequestLog, errorRecord, logInBackground, maskPii, type RequestLog } from "../requestLog";
import { visitorId } from "../visitor";
import { createMemorySearch } from "../search";
import { diffCarts } from "../cart/diff";
import { endNote } from "../cart/notes";
import type { Product } from "../schema";
import { chatRecord } from "./log";
import { runChatTurn, solveSession, type ChatTurnInput, type ChatTurnResult } from "./loop";
import { openAiChatModel } from "./model";
import { ActionSchema, applyAction, emptySession, parseSession } from "./session";
import { defaultShareStore, type ShareStore } from "./share";
import type { ChatEvent } from "./tools";

export const MAX_BODY_BYTES = 96 * 1024;

const ChatRequestSchema = z.object({
  session: z.unknown().optional(),
  message: z.string().trim().min(1, "Type what you'd like").max(300, "That's too long (max 300 characters)"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(600) }))
    .max(12)
    .default([]),
  /** The chat this turn belongs to, and the turn before it, for the request log. */
  session_id: z.string().uuid().optional(),
  parent_id: z.string().uuid().optional(),
});

export type ChatDone = { type: "done" } & Pick<ChatTurnResult, "status" | "reply" | "question" | "session" | "cart" | "checks" | "diff" | "note" | "pending"> & {
    meta: Pick<ChatTurnResult["meta"], "latency_ms" | "model_calls" | "tool_calls" | "cost_usd" | "cost_inr" | "steps" | "finished_by"> & {
      request_id: string;
      session_id: string;
      cached: boolean;
    };
  };
export type ChatStreamEvent = ChatEvent | ChatDone | { type: "error"; error: string };

/** First turns of a chat, keyed by the normalised message (the handler normalises it): a repeated "pasta night for 4" costs nothing. */
export interface TurnCache {
  get(message: string): Promise<ChatTurnResult | null>;
  set(message: string, r: ChatTurnResult): Promise<void>;
}
export const CHAT_CACHE_VERSION = "c2";
export const noTurnCache: TurnCache = { get: async () => null, set: async () => {} };
/** "  Pasta night for 4!! " and "pasta night for 4" are one cache entry. */
export const normalise = (q: string) => q.toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();

export function createRedisTurnCache(redis: Redis, model: string): TurnCache {
  const key = (m: string) => `acb:chat:${CHAT_CACHE_VERSION}:${model}:${createHash("sha256").update(m).digest("hex").slice(0, 32)}`;
  return {
    async get(m) {
      return (await redis.get<ChatTurnResult>(key(m))) ?? null;
    },
    async set(m, r) {
      await redis.set(key(m), r, { ex: 30 * 24 * 3600 });
    },
  };
}

export type ChatApiDeps = {
  limiter: Limiter;
  solveLimiter: Limiter;
  requestLog: RequestLog;
  cache: TurnCache;
  shares: ShareStore;
  products: Product[];
  index: CatalogIndex;
  run: (input: ChatTurnInput, opts: { onEvent: (e: ChatEvent) => void; signal: AbortSignal; traceId: string }) => Promise<ChatTurnResult>;
};

const noLimit: Limiter = { check: async () => ({ ok: true }) };
const num = (v: string | undefined, fallback: number) => (v && Number(v) > 0 ? Number(v) : fallback);

let defaults: ChatApiDeps | null = null;
function defaultDeps(): ChatApiDeps {
  if (defaults) return defaults;
  const redis = redisFromEnv();
  const limitsOn = process.env.NODE_ENV === "production" || process.env.RATE_LIMIT_IN_DEV === "1";
  const limiter = (config: LimitConfig, prefix: string): Limiter => (!limitsOn ? noLimit : redis ? createUpstashLimiter(redis, config, prefix) : createMemoryLimiter(config));
  const search = createMemorySearch(catalog);
  const kinds = new Set(catalog.filter((p) => p.in_stock).map((p) => p.sub_category));
  defaults = {
    limiter: limiter({ perHour: num(process.env.CHAT_RATE_LIMIT_PER_HOUR, 40), perDay: num(process.env.CHAT_DAILY_CAP, 800) }, "acb:chat:rl"),
    solveLimiter: limiter({ perHour: 600, perDay: 50_000 }, "acb:solve:rl"),
    requestLog: defaultRequestLog(),
    cache: redis ? createRedisTurnCache(redis, modelName()) : noTurnCache,
    shares: defaultShareStore(),
    products: catalog,
    index: catalogIndex,
    run: (input, { onEvent, signal, traceId }) =>
      runChatTurn(input, {
        model: openAiChatModel,
        products: catalog,
        index: catalogIndex,
        search,
        kinds,
        onEvent,
        signal,
        traceId,
        log: (line) => console.log(JSON.stringify(typeof line.message === "string" ? { ...line, message: maskPii(line.message) } : line)),
      }),
  };
  return defaults;
}

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return { ok: false, res: json({ error: "That request is too large." }, 413) };
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false, res: json({ error: "That request is too large." }, 413) };
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, res: json({ error: "Send JSON." }, 400) };
  }
}

async function limited(limiter: Limiter, req: Request, what: string): Promise<Response | null> {
  try {
    const limit = await limiter.check(clientIp(req));
    if (!limit.ok) {
      const error = limit.scope === "daily" ? `${what} has reached its daily limit. Please try again tomorrow.` : "Too many requests in a short time. Please try again later.";
      return json({ error, retry_after: limit.retryAfter }, 429, { "Retry-After": String(limit.retryAfter) });
    }
  } catch (err) {
    // If the limiter is down, let the request through.
    console.error("[chat] rate limiter failed:", err instanceof Error ? err.message : err);
  }
  return null;
}

const isFresh = (input: ChatTurnInput) =>
  input.history.length === 0 && input.session.needs.length === 0 && input.session.pins.length === 0 && input.session.brief.rules.length === 0 && !input.session.brief.summary;

/** POST /api/chat */
export async function handleChat(req: Request, deps: ChatApiDeps = defaultDeps()): Promise<Response> {
  const read = await readJson(req);
  if (!read.ok) return read.res;
  const parsed = ChatRequestSchema.safeParse(read.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ error: issue?.path[0] === "message" ? issue.message : `Invalid request: ${issue?.path.join(".") || "body"} ${issue?.message ?? ""}`.trim() }, 400);
  }
  const { message, history } = parsed.data;
  const s = parsed.data.session === undefined ? { ok: true as const, session: emptySession() } : parseSession(parsed.data.session);
  if (!s.ok) return json({ error: s.error }, 400);
  const blocked = await limited(deps.limiter, req, "Jhola");
  if (blocked) return blocked;

  const input: ChatTurnInput = { session: s.session, message, history };
  const id = randomUUID();
  const session_id = parsed.data.session_id ?? id;
  const visitor = visitorId(clientIp(req));
  const started = Date.now();
  const before = solveSession(s.session, deps).cart;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // The shopper left; the turn is being cancelled.
        }
      };
      try {
        const fresh = isFresh(input);
        const cacheKey = normalise(message);
        let r = fresh ? await deps.cache.get(cacheKey).catch(() => null) : null;
        const cached = r != null;
        if (r) {
          // Replay a cached first turn in the same order a live one streams.
          send({ type: "brief", brief: r.session.brief });
          send({ type: "needs", needs: r.session.needs });
          // Stock may have changed since it was cached: solve again.
          const now = solveSession(r.session, deps);
          r = { ...r, session: now.session, cart: now.cart, checks: now.checks, note: endNote(now.session, now.cart), diff: diffCarts(null, now.cart) };
          send({ type: "cart", cart: r.cart, checks: r.checks });
          r = { ...r, meta: { ...r.meta, latency_ms: Date.now() - started, cost_usd: 0, cost_inr: 0, model_calls: 0, tool_calls: 0, steps: [], input_tokens: 0, cached_tokens: 0, output_tokens: 0 } };
        } else {
          r = await deps.run(input, { onEvent: send, signal: req.signal, traceId: id });
          if (fresh && r.status === "done" && r.question == null) await deps.cache.set(cacheKey, r).catch(() => {});
        }
        const { latency_ms, model_calls, tool_calls, cost_usd, cost_inr, steps, finished_by } = r.meta;
        send({
          type: "done",
          status: r.status,
          reply: r.reply,
          question: r.question,
          session: r.session,
          cart: r.cart,
          checks: r.checks,
          diff: r.diff,
          note: r.note,
          pending: r.pending,
          meta: { request_id: id, session_id, latency_ms, model_calls, tool_calls, cost_usd, cost_inr, steps, finished_by, cached },
        });
        logInBackground(deps.requestLog, chatRecord({ id, parent_id: parsed.data.parent_id ?? null, session_id, visitor, message, before, result: r, cached }));
      } catch (err) {
        console.error("[chat] turn failed:", err);
        logInBackground(deps.requestLog, errorRecord({ id, kind: "agent", visitor, query: message, error_kind: "unexpected", latency_ms: Date.now() - started, parent_id: parsed.data.parent_id ?? null }));
        send({ type: "error", error: "Something went wrong, so your cart wasn't changed. Please try again." });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

const SolveRequestSchema = z.object({ session: z.unknown(), action: ActionSchema });

/** POST /api/solve: a tap, applied and solved in code. */
export async function handleSolve(req: Request, deps: ChatApiDeps = defaultDeps()): Promise<Response> {
  const read = await readJson(req);
  if (!read.ok) return read.res;
  const parsed = SolveRequestSchema.safeParse(read.body);
  if (!parsed.success) return json({ error: `Invalid request: ${parsed.error.issues[0]?.path.join(".") || "body"} ${parsed.error.issues[0]?.message ?? ""}`.trim() }, 400);
  const s = parseSession(parsed.data.session);
  if (!s.ok) return json({ error: s.error }, 400);
  const blocked = await limited(deps.solveLimiter, req, "Jhola");
  if (blocked) return blocked;
  const started = performance.now();
  const before = solveSession(s.session, deps);
  const next = applyAction(before.session, parsed.data.action, deps.index);
  if (typeof next === "string") return json({ error: next }, 422);
  const after = solveSession(next, deps);
  return json(
    {
      session: after.session,
      cart: after.cart,
      checks: after.checks,
      diff: diffCarts(before.cart, after.cart),
      note: endNote(after.session, after.cart),
      meta: { ms: Math.round((performance.now() - started) * 100) / 100 },
    },
    200,
  );
}

/** POST /api/share: saves a snapshot and returns its link. */
export async function handleShare(req: Request, deps: ChatApiDeps = defaultDeps()): Promise<Response> {
  const read = await readJson(req);
  if (!read.ok) return read.res;
  const s = parseSession((read.body as { session?: unknown })?.session);
  if (!s.ok) return json({ error: s.error }, 400);
  if (!s.session.needs.length) return json({ error: "There's nothing in the cart to share yet." }, 400);
  const blocked = await limited(deps.solveLimiter, req, "Sharing");
  if (blocked) return blocked;
  try {
    const id = await deps.shares.save(s.session);
    return json({ id, path: `/c/${id}` }, 200);
  } catch (err) {
    console.error("[share] save failed:", err instanceof Error ? err.message : err);
    return json({ error: "Couldn't make a link right now. Please try again." }, 503);
  }
}
