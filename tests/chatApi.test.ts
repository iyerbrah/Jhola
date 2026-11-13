import { describe, expect, it } from "vitest";
import { handleChat, handleShare, handleSolve, type ChatApiDeps, type ChatStreamEvent, type TurnCache } from "@/lib/chat/api";
import { runChatTurn, type ChatTurnResult } from "@/lib/chat/loop";
import { createMemoryShareStore } from "@/lib/chat/share";
import { createMemoryRequestLog } from "@/lib/log/requestLog";
import type { Limiter } from "@/lib/ratelimit";
import { build, kinds, scripted, search, step } from "./chatHarness";
import { index, products } from "./cartFixtures";

const open: Limiter = { check: async () => ({ ok: true }) };

function deps(script: ReturnType<typeof step>[] = [], extra: Partial<ChatApiDeps> = {}) {
  const requestLog = createMemoryRequestLog(50);
  const store = new Map<string, ChatTurnResult>();
  const cache: TurnCache = { get: async (m) => store.get(m) ?? null, set: async (m, r) => void store.set(m, r) };
  const model = scripted(script);
  const d: ChatApiDeps = {
    limiter: open,
    solveLimiter: open,
    requestLog,
    cache,
    shares: createMemoryShareStore(),
    products,
    index,
    run: (input, { onEvent, signal, traceId }) => runChatTurn(input, { model, products, index, search, kinds, onEvent, signal, traceId, log: () => {}, limits: { maxOffers: 0 } }),
    ...extra,
  };
  return { d, requestLog, store };
}

const post = (path: string, body: unknown) => new Request(`http://local${path}`, { method: "POST", body: JSON.stringify(body) });

async function events(res: Response): Promise<ChatStreamEvent[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const buildStep = () => step(["update_cart", build()]);

describe("POST /api/chat", () => {
  it("streams the understanding line, the plan, the cart, then done", async () => {
    const { d, requestLog } = deps([buildStep()]);
    const res = await handleChat(post("/api/chat", { message: "pasta night for 4" }), d);
    expect(res.headers.get("content-type")).toMatch(/ndjson/);
    const ev = await events(res);
    const types = ev.map((e) => e.type).filter((t) => t !== "status");
    expect(types[0]).toBe("brief");
    expect(types.at(-1)).toBe("done");
    const done = ev.at(-1) as Extract<ChatStreamEvent, { type: "done" }>;
    expect(done).toMatchObject({ status: "done", meta: { cached: false, model_calls: 1 } });
    expect(done.cart.lines.length).toBe(5);
    await new Promise((r) => setTimeout(r, 0));
    expect(requestLog.records[0]).toMatchObject({ kind: "agent", status: "done", query: "pasta night for 4" });
    expect(requestLog.records[0].carts.map((c) => c.role)).toEqual(["before", "after"]);
  });

  it("answers a repeated first message from the cache, re-solved, at no cost", async () => {
    const { d } = deps([buildStep()]);
    await events(await handleChat(post("/api/chat", { message: "pasta night for 4" }), d));
    const ev = await events(await handleChat(post("/api/chat", { message: "Pasta night for 4!" }), d));
    const done = ev.at(-1) as Extract<ChatStreamEvent, { type: "done" }>;
    expect(done.meta).toMatchObject({ cached: true, cost_usd: 0, model_calls: 0 });
    expect(done.cart.lines.length).toBe(5);
    expect(ev.map((e) => e.type).slice(0, 3)).toEqual(["brief", "needs", "cart"]);
  });

  it("rejects a bad request before spending anything", async () => {
    const { d } = deps();
    expect((await handleChat(post("/api/chat", { message: "" }), d)).status).toBe(400);
    expect((await handleChat(post("/api/chat", { message: "hi", session: { brief: 1 } }), d)).status).toBe(400);
    expect((await handleChat(new Request("http://local/api/chat", { method: "POST", body: "x".repeat(100_000) }), d)).status).toBe(413);
  });

  it("rate-limits", async () => {
    const { d } = deps([], { limiter: { check: async () => ({ ok: false, retryAfter: 60, scope: "ip" }) } });
    const res = await handleChat(post("/api/chat", { message: "pasta" }), d);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});

describe("POST /api/solve and /api/share", () => {
  async function built() {
    const { d } = deps([buildStep()]);
    const done = (await events(await handleChat(post("/api/chat", { message: "pasta night for 4" }), d))).at(-1) as Extract<ChatStreamEvent, { type: "done" }>;
    return { d, session: done.session };
  }

  it("applies a chip with no model call and returns the diff", async () => {
    const { d, session } = await built();
    const res = await handleSolve(post("/api/solve", { session, action: { type: "brief", people: 8 } }), d);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.session.brief.people).toBe(8);
    expect(body.diff.packs.length).toBeGreaterThan(0);
    expect(body.meta.ms).toBeLessThan(50);
  });

  it("says why a tap can't be applied", async () => {
    const { d, session } = await built();
    const res = await handleSolve(post("/api/solve", { session, action: { type: "pin", need_id: "pasta", product_id: "p0000", qty: null } }), d);
    expect(res.status).toBe(422);
  });

  it("shares a snapshot behind a short link", async () => {
    const { d, session } = await built();
    const body = await (await handleShare(post("/api/share", { session }), d)).json();
    expect(body.path).toMatch(/^\/c\/[A-Za-z0-9_-]{10}$/);
    expect(await d.shares.load(body.id)).toMatchObject({ needs: session.needs });
  });
});
