import { describe, expect, it } from "vitest";
import { handleBuildCarts, clientIp, type ApiDeps } from "@/lib/api";
import { normalizeQuery, type ResponseCache } from "@/lib/cache";
import { createMemoryHistory } from "@/lib/history";
import { LlmError } from "@/lib/llm";
import { createMemoryLimiter } from "@/lib/ratelimit";
import type { BuildCartsResponse } from "@/lib/schema";

const answer = (query: string): BuildCartsResponse => ({
  status: "ok",
  message: "",
  assumptions: [],
  suggestions: [],
  variants: [1, 2, 3].map((n) => ({ name: `Cart ${n}`, reason: query, items: [], total: n })),
  meta: { latency_ms: 1, model: "fake", repaired: false, input_tokens: 0, cached_tokens: 0, output_tokens: 0 },
});

function memoryCache(): ResponseCache & { store: Map<string, BuildCartsResponse> } {
  const store = new Map<string, BuildCartsResponse>();
  return { store, get: async (q) => store.get(normalizeQuery(q)) ?? null, set: async (q, r) => void store.set(normalizeQuery(q), r) };
}

function setup(overrides: Partial<ApiDeps> = {}) {
  const built: string[] = [];
  const deps: ApiDeps = {
    limiter: createMemoryLimiter({ perHour: 10, perDay: 300 }),
    cache: memoryCache(),
    history: createMemoryHistory(),
    build: async (q) => (built.push(q), answer(q)),
    deadlineMs: 1000,
    ...overrides,
  };
  return { deps, built };
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

describe("generation history", () => {
  it("saves each generation with its cost, but not cache hits or failures", async () => {
    const real = { ...answer("x"), meta: { ...answer("x").meta, model: "gpt-5.4-mini-2026-03-17", input_tokens: 62000, cached_tokens: 58000, output_tokens: 1400 } };
    const { deps } = setup({ build: async () => real });
    await handleBuildCarts(post({ query: "poha for 2" }), deps);
    await handleBuildCarts(post({ query: "poha for 2" }), deps); // cache hit
    const entries = await deps.history.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].query).toBe("poha for 2");
    // 4000 × 0.75 + 58000 × 0.075 + 1400 × 4.50, per million
    expect(entries[0].cost_usd).toBeCloseTo(0.01365, 6);

    const failing = setup({ build: async () => { throw new LlmError("down"); } });
    await handleBuildCarts(post({ query: "poha" }), failing.deps);
    expect(await failing.deps.history.list()).toHaveLength(0);
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for address", () => {
    expect(clientIp(post({}, "9.9.9.9"))).toBe("9.9.9.9");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "8.8.8.8" } }))).toBe("8.8.8.8");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });
});
