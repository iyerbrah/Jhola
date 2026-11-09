import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FeedbackRequestSchema, handleFeedback, type FeedbackDeps } from "@/lib/feedback";
import { createMemoryLimiter } from "@/lib/ratelimit";
import { createMemoryRequestLog, type RequestLog, type RequestRecord } from "@/lib/requestLog";

const cart = (position: number) => ({ role: "result" as const, position, name: `Cart ${position + 1}`, reason: "", total: 100, items: [] });
const request = (kind: "build" | "agent", over: Partial<RequestRecord> = {}): RequestRecord => ({
  id: randomUUID(),
  kind,
  visitor: "v",
  query: "q",
  status: kind === "build" ? "ok" : "done",
  cached: false,
  latency_ms: 1,
  catalog_size: 1,
  meta: {},
  carts: kind === "build" ? [cart(0), cart(1), cart(2)] : [],
  steps: [],
  ...over,
});

async function setup(over: Partial<FeedbackDeps> = {}) {
  const log = createMemoryRequestLog();
  const build = request("build");
  const turn = request("agent");
  await log.record(build);
  await log.record(turn);
  const deps: FeedbackDeps = { limiter: createMemoryLimiter({ perHour: 60, perDay: 2000 }), requestLog: log, ...over };
  return { log, build, turn, deps };
}

const post = (body: unknown, ip = "1.2.3.4") =>
  new Request("http://localhost/api/feedback", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("FeedbackRequestSchema", () => {
  it("needs a real request id, a target, a cart for cart votes, and a rating of 1, -1 or 0", () => {
    const id = randomUUID();
    expect(FeedbackRequestSchema.safeParse({ request_id: id, target: "cart", cart: 1, rating: 1 }).success).toBe(true);
    expect(FeedbackRequestSchema.safeParse({ request_id: id, target: "reply", rating: -1 }).success).toBe(true);
    for (const bad of [
      { request_id: "x", target: "cart", cart: 0, rating: 1 },
      { request_id: id, target: "cart", rating: 1 },
      { request_id: id, target: "cart", cart: 3, rating: 1 },
      { request_id: id, target: "reply", rating: 2 },
      { request_id: id, target: "page", rating: 1 },
    ]) {
      expect(FeedbackRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("POST /api/feedback", () => {
  it("saves a vote, changes it, and takes it back", async () => {
    const { deps, log, build } = await setup();
    const vote = (rating: number) => handleFeedback(post({ request_id: build.id, target: "cart", cart: 2, rating }), deps);
    expect((await vote(1)).status).toBe(204);
    expect([...log.votes.values()]).toEqual([expect.objectContaining({ request_id: build.id, target: "cart", cart_position: 2, rating: 1 })]);
    expect((await vote(-1)).status).toBe(204);
    expect([...log.votes.values()].map((v) => v.rating)).toEqual([-1]);
    expect((await vote(0)).status).toBe(204);
    expect(log.votes.size).toBe(0);
  });

  it("keeps one vote per visitor, and a reply's vote apart from the carts'", async () => {
    const { deps, log, build, turn } = await setup();
    await handleFeedback(post({ request_id: build.id, target: "cart", cart: 0, rating: 1 }, "1.1.1.1"), deps);
    await handleFeedback(post({ request_id: build.id, target: "cart", cart: 0, rating: -1 }, "2.2.2.2"), deps);
    await handleFeedback(post({ request_id: turn.id, target: "reply", rating: 1 }, "1.1.1.1"), deps);
    expect(log.votes.size).toBe(3);
    expect([...log.votes.values()].find((v) => v.target === "reply")?.cart_position).toBe(-1);
  });

  it("refuses unknown requests, the wrong target, and bad input", async () => {
    const { deps, build, turn } = await setup();
    expect((await handleFeedback(post({ request_id: randomUUID(), target: "cart", cart: 0, rating: 1 }), deps)).status).toBe(404);
    expect((await handleFeedback(post({ request_id: build.id, target: "reply", rating: 1 }), deps)).status).toBe(400);
    expect((await handleFeedback(post({ request_id: turn.id, target: "cart", cart: 0, rating: 1 }), deps)).status).toBe(400);
    expect((await handleFeedback(post("not json"), deps)).status).toBe(400);
  });

  it("refuses a cart the build didn't have", async () => {
    const { deps, log } = await setup();
    const partial = request("build", { carts: [cart(0)] });
    await log.record(partial);
    expect((await handleFeedback(post({ request_id: partial.id, target: "cart", cart: 2, rating: 1 }), deps)).status).toBe(400);
  });

  it("rate-limits votes per person", async () => {
    const { deps, build } = await setup({ limiter: createMemoryLimiter({ perHour: 2, perDay: 100 }) });
    for (let i = 0; i < 2; i++) await handleFeedback(post({ request_id: build.id, target: "cart", cart: 0, rating: 1 }), deps);
    expect((await handleFeedback(post({ request_id: build.id, target: "cart", cart: 0, rating: 1 }), deps)).status).toBe(429);
  });

  it("answers 503 if the log can't be reached", async () => {
    const broken: RequestLog = { record: async () => {}, recentBuilds: async () => [], rate: async () => { throw new Error("db down"); } };
    const { deps, build } = await setup({ requestLog: broken });
    expect((await handleFeedback(post({ request_id: build.id, target: "cart", cart: 0, rating: 1 }), deps)).status).toBe(503);
  });
});
