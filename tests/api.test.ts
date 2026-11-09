import { describe, expect, it } from "vitest";
import { handleBuildCarts, clientIp, type ApiDeps } from "@/lib/api";
import { normalizeQuery, type ResponseCache } from "@/lib/cache";
import { createMemoryRequestLog, type RequestLog } from "@/lib/requestLog";
import { LlmError } from "@/lib/llm";
import { createMemoryLimiter } from "@/lib/ratelimit";
import type { BuildCartsResponse } from "@/lib/schema";

const answer = (query: string): BuildCartsResponse => ({
  status: "ok",
  message: "",
  assumptions: [],
  suggestions: [],
  variants: [1, 2, 3].map((n) => ({ name: `Cart ${n}`, reason: query, items: [], total: n })),
  requirements: { budget_inr: null, item_count: null, item_kind: null, must_include: [], diet: null },
  meta: { latency_ms: 1, model: "fake", repaired: false, input_tokens: 0, cached_tokens: 0, output_tokens: 0 },
});

function memoryCache(): ResponseCache & { store: Map<string, BuildCartsResponse> } {
  const store = new Map<string, BuildCartsResponse>();
  return { store, get: async (q) => store.get(normalizeQuery(q)) ?? null, set: async (q, r) => void store.set(normalizeQuery(q), r) };
}

function setup(overrides: Partial<ApiDeps> = {}) {
  const built: string[] = [];
  const log = createMemoryRequestLog();
  const deps: ApiDeps = {
    limiter: createMemoryLimiter({ perHour: 10, perDay: 300 }),
    cache: memoryCache(),
    requestLog: log,
    build: async (q) => (built.push(q), answer(q)),
    deadlineMs: 1000,
    ...overrides,
  };
  return { deps, built, log };
}

const post = (body: unknown, ip = "1.2.3.4") =>
  new Request("http://localhost/api/build-carts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/build-carts", () => {
  it("returns 200 with carts for a valid query", async () => {
    const { deps, built } = setup();
    const res = await handleBuildCarts(post({ query: "  paneer for 4  " }), deps);
    expect(res.status).toBe(200);
    expect(built).toEqual(["paneer for 4"]); // trimmed
    expect((await res.json()).variants).toHaveLength(3);
  });

  it("returns 400 for missing, short, long or non-JSON queries", async () => {
    const { deps, built } = setup();
    for (const body of [{}, { query: "ab" }, { query: "x".repeat(301) }, "not json"]) {
      const res = await handleBuildCarts(post(body), deps);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
    expect(built).toEqual([]);
  });

  it("returns 429 with retry_after on the 11th request in an hour from one IP", async () => {
    const { deps } = setup();
    for (let i = 0; i < 10; i++) expect((await handleBuildCarts(post({ query: `poha ${i}` }), deps)).status).toBe(200);
    const res = await handleBuildCarts(post({ query: "poha 11" }), deps);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.retry_after).toBeGreaterThan(0);
    expect(res.headers.get("Retry-After")).toBe(String(body.retry_after));
    // Another IP is unaffected.
    expect((await handleBuildCarts(post({ query: "poha" }, "5.6.7.8"), deps)).status).toBe(200);
  });

  it("enforces the global daily cap across IPs", async () => {
    const { deps } = setup({ limiter: createMemoryLimiter({ perHour: 10, perDay: 2 }) });
    expect((await handleBuildCarts(post({ query: "poha" }, "1.1.1.1"), deps)).status).toBe(200);
    expect((await handleBuildCarts(post({ query: "poha" }, "2.2.2.2"), deps)).status).toBe(200);
    const res = await handleBuildCarts(post({ query: "poha" }, "3.3.3.3"), deps);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("daily limit");
  });

  it("serves a repeated query from the cache without rebuilding", async () => {
    const { deps, built } = setup();
    await handleBuildCarts(post({ query: "Paneer for 4" }), deps);
    const res = await handleBuildCarts(post({ query: "paneer   for 4!" }), deps);
    expect(built).toHaveLength(1);
    const { meta } = await res.json();
    expect(meta.cached).toBe(true);
    expect(meta.input_tokens + meta.output_tokens).toBe(0);
  });

  it("does not cache an answer that lost carts", async () => {
    const short = { ...answer("x"), status: "partial" as const, variants: answer("x").variants.slice(0, 2) };
    const { deps, built } = setup({ build: async (q) => (built.push(q), short) });
    await handleBuildCarts(post({ query: "poha" }), deps);
    await handleBuildCarts(post({ query: "poha" }), deps);
    expect(built).toHaveLength(2);
  });

  it("returns 502 when the LLM fails or takes too long", async () => {
    const failing = setup({ build: async () => { throw new LlmError("down"); } });
    expect((await handleBuildCarts(post({ query: "poha" }), failing.deps)).status).toBe(502);

    const slow = setup({ build: () => new Promise((r) => setTimeout(() => r(answer("x")), 500)), deadlineMs: 50 });
    expect((await handleBuildCarts(post({ query: "poha" }), slow.deps)).status).toBe(502);
  });

  it("lets requests through if the rate limiter itself is down", async () => {
    const { deps } = setup({ limiter: { check: async () => { throw new Error("redis down"); } } });
    expect((await handleBuildCarts(post({ query: "poha" }), deps)).status).toBe(200);
  });
});

describe("request log", () => {
  const real = { ...answer("x"), meta: { ...answer("x").meta, model: "gpt-5.4-mini-2026-03-17", input_tokens: 62000, cached_tokens: 58000, output_tokens: 1400 } };

  it("saves each build with its cost and carts, and returns its request_id", async () => {
    const { deps, log } = setup({ build: async () => real });
    const res = await (await handleBuildCarts(post({ query: "poha for 2" }), deps)).json();
    expect(res.meta.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(log.records).toHaveLength(1);
    const r = log.records[0];
    expect(r).toMatchObject({ id: res.meta.request_id, kind: "build", query: "poha for 2", status: "ok", cached: false });
    // 4000 × 0.75 + 58000 × 0.075 + 1400 × 4.50, per million
    expect(r.cost_usd).toBeCloseTo(0.01365, 6);
    expect(r.carts.map((c) => [c.role, c.name])).toEqual([["result", "Cart 1"], ["result", "Cart 2"], ["result", "Cart 3"]]);
    expect(r.visitor).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(r)).not.toContain("1.2.3.4");
    expect((await log.recentBuilds(10)).map((e) => e.query)).toEqual(["poha for 2"]);
  });

  it("saves the model calls as trace steps", async () => {
    const { deps, log } = setup({
      build: async (_q, opts) => {
        opts?.onStep?.({ kind: "model", name: "plan", attempt: 1, ok: true, ms: 900, input_tokens: 10, cached_tokens: 5, output_tokens: 3 });
        opts?.onStep?.({ kind: "model", name: "cart:1", attempt: 1, ok: false, ms: 50, error: "timeout" });
        return answer("x");
      },
    });
    await handleBuildCarts(post({ query: "poha" }), deps);
    expect(log.records[0].steps.map((s) => `${s.name}:${s.ok}`)).toEqual(["plan:true", "cart:1:false"]);
  });

  it("saves cache hits (free, with a new request_id) and failures, but lists neither in /history", async () => {
    const { deps, log } = setup({ build: async () => real });
    const first = await (await handleBuildCarts(post({ query: "poha for 2" }), deps)).json();
    const hit = await (await handleBuildCarts(post({ query: "poha for 2" }), deps)).json();
    expect(hit.meta.request_id).not.toBe(first.meta.request_id);
    expect(log.records[0]).toMatchObject({ cached: true, cost_usd: 0 });

    const failing = setup({ build: async () => { throw new LlmError("down", "timeout"); } });
    await handleBuildCarts(post({ query: "poha" }), failing.deps);
    expect(failing.log.records[0]).toMatchObject({ status: "error", error_kind: "timeout", query: "poha" });
    expect(await failing.log.recentBuilds(10)).toEqual([]);
    expect((await log.recentBuilds(10)).length).toBe(1);
  });

  it("answers normally when saving fails or hangs", async () => {
    const broken: RequestLog = { record: async () => { throw new Error("db down"); }, recentBuilds: async () => [], rate: async () => "unknown" };
    const hanging: RequestLog = { record: () => new Promise(() => {}), recentBuilds: async () => [], rate: async () => "unknown" };
    for (const requestLog of [broken, hanging]) {
      const { deps } = setup({ requestLog });
      const t = Date.now();
      const res = await handleBuildCarts(post({ query: "poha" }), deps);
      expect(res.status).toBe(200);
      expect(Date.now() - t).toBeLessThan(200);
    }
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for address when there is no x-real-ip", () => {
    expect(clientIp(post({}, "9.9.9.9"))).toBe("9.9.9.9");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "8.8.8.8" } }))).toBe("8.8.8.8");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });

  it("prefers x-real-ip, which the proxy sets, over a faked x-forwarded-for", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "x-real-ip": "5.6.7.8" } });
    expect(clientIp(req)).toBe("5.6.7.8");
  });
});

describe("502 reasons", () => {
  it("says what kind of LLM failure happened, without details", async () => {
    const { deps } = setup({ build: async () => { throw new LlmError("OPENAI_API_KEY is not set", "missing_key"); } });
    const res = await handleBuildCarts(post({ query: "poha" }), deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "The cart builder had trouble answering. Please try again.", reason: "missing_key" });
  });

  it("classifies provider errors by status", async () => {
    const { classifyError } = await import("@/lib/llm");
    expect(classifyError(Object.assign(new Error("Incorrect API key provided"), { status: 401 }))).toBe("bad_key");
    expect(classifyError(Object.assign(new Error("You exceeded your current quota"), { status: 429 }))).toBe("quota");
    expect(classifyError(new Error("Request timed out."))).toBe("timeout");
    expect(classifyError(Object.assign(new Error("boom"), { status: 500 }))).toBe("provider");
  });
});
