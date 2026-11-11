import { randomUUID } from "node:crypto";
import { buildCarts, type BuildStep } from "./buildCarts";
import { createRedisCache, noCache, type ResponseCache } from "./cache";
import { LlmError, modelName } from "./llm";
import { buildRecord, defaultRequestLog, errorRecord, logInBackground, type RequestLog, type StepRecord } from "./requestLog";
import { clientIp, json } from "./http";
import { visitorId } from "./visitor";
import { createMemoryLimiter, createUpstashLimiter, limitConfigFromEnv, redisFromEnv, type Limiter } from "./ratelimit";
import { BuildCartsRequestSchema, type BuildCartsResponse } from "./schema";

export type ApiDeps = {
  limiter: Limiter;
  cache: ResponseCache;
  /** Where every request, its carts and its model calls are saved (Postgres, or memory without one). */
  requestLog: RequestLog;
  build: (query: string, opts?: { onStep?: (step: BuildStep) => void }) => Promise<BuildCartsResponse>;
  /** Give up and return 502 after this long, instead of hanging. */
  deadlineMs: number;
};

let defaults: ApiDeps | null = null;

const noLimit: Limiter = { check: async () => ({ ok: true }) };

/** Real dependencies: Upstash when configured, otherwise in-memory limits and no cache. */
function defaultDeps(): ApiDeps {
  if (defaults) return defaults;
  const redis = redisFromEnv();
  const config = limitConfigFromEnv();
  if (!redis) console.warn("[build-carts] Upstash is not configured: using in-memory rate limits and no cache.");
  // On your own machine (npm run dev) there are no limits, so testing never gets blocked.
  // Set RATE_LIMIT_IN_DEV=1 to try the limits locally. The deployed site always enforces them.
  const limitsOn = process.env.NODE_ENV === "production" || process.env.RATE_LIMIT_IN_DEV === "1";
  if (!limitsOn) console.warn("[build-carts] Rate limits are off in development.");
  defaults = {
    limiter: !limitsOn ? noLimit : redis ? createUpstashLimiter(redis, config) : createMemoryLimiter(config),
    cache: redis ? createRedisCache(redis, modelName()) : noCache,
    requestLog: defaultRequestLog(),
    build: (query, opts) => buildCarts(query, { onStep: opts?.onStep }),
    deadlineMs: 50_000,
  };
  return defaults;
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new LlmError(`Timed out after ${ms} ms`, "timeout")), ms);
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** POST /api/build-carts */
export async function handleBuildCarts(req: Request, deps: ApiDeps = defaultDeps()): Promise<Response> {
  // 1. Input
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON like {\"query\": \"paneer butter masala for 4\"}" }, 400);
  }
  const parsed = BuildCartsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }
  const query = parsed.data.query;

  // 2. Rate limit (before anything that costs money). If Redis is down, let the request through.
  try {
    const limit = await deps.limiter.check(clientIp(req));
    if (!limit.ok) {
      const error =
        limit.scope === "daily"
          ? "The app has reached its daily limit. Please try again tomorrow."
          : "Too many requests. Please try again later.";
      return json({ error, retry_after: limit.retryAfter }, 429, { "Retry-After": String(limit.retryAfter) });
    }
  } catch (err) {
    console.error("[build-carts] rate limiter failed:", err instanceof Error ? err.message : err);
  }

  // 3. Cache, then the pipeline. Every answer (and every failure) is saved to the request log in
  // the background: the shopper never waits for it.
  const started = Date.now();
  const id = randomUUID();
  const visitor = visitorId(clientIp(req));
  const steps: StepRecord[] = [];
  try {
    const hit = await deps.cache.get(query).catch(() => null);
    if (hit) {
      // No model call was made, so this request used no tokens.
      const meta = { ...hit.meta, cached: true, latency_ms: Date.now() - started, input_tokens: 0, cached_tokens: 0, output_tokens: 0, request_id: id };
      const res = { ...hit, meta };
      log(query, res);
      logInBackground(deps.requestLog, buildRecord({ id, visitor, query, res, steps, cached: true }));
      return json(res, 200);
    }

    const built = await withDeadline(deps.build(query, { onStep: (s) => steps.push(s) }), deps.deadlineMs);
    const res = { ...built, meta: { ...built.meta, request_id: id } };
    log(query, res);
    logInBackground(deps.requestLog, buildRecord({ id, visitor, query, res, steps, cached: false }));
    // Don't cache an answer that lost carts: that is often a one-off provider blip.
    const complete = res.status === "cannot_fulfil" || res.variants.length === 3;
    if (complete) await deps.cache.set(query, built).catch(() => {});
    return json(res, 200);
  } catch (err) {
    const error_kind = err instanceof LlmError ? err.kind : "unexpected";
    logInBackground(deps.requestLog, errorRecord({ id, kind: "build", visitor, query, error_kind, latency_ms: Date.now() - started }));
    if (err instanceof LlmError) {
      console.error(`[build-carts] LLM failed (${err.kind}):`, err.message);
      // `reason` says what kind of failure it was (never the key or the message), to make deploy problems easy to spot.
      return json({ error: "The cart builder had trouble answering. Please try again.", reason: err.kind }, 502);
    }
    console.error("[build-carts] unexpected error:", err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}

/** One line per request: the query text and metrics only, nothing about the caller. */
function log(query: string, res: BuildCartsResponse) {
  const { latency_ms, model, repaired, cached, input_tokens, cached_tokens, output_tokens, request_id } = res.meta;
  console.log(
    JSON.stringify({ event: "build_carts", request_id, query, status: res.status, latency_ms, model, repaired, cached: !!cached, input_tokens, cached_tokens, output_tokens }),
  );
}
