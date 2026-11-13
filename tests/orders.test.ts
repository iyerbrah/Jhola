import { randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { adminToken, checkKey, keyMatches, tokenValid } from "@/lib/admin";
import { buildExport, csvCell, EXPORT_FILES, handleExport, toCsv } from "@/lib/log/export";
import { handleOrder, handleOrderRating, type OrderDeps } from "@/lib/log/order";
import { createMemoryLimiter } from "@/lib/ratelimit";
import { createMemoryRequestLog, maskPublic, type RequestRecord } from "@/lib/log/requestLog";
import { filterRuns, headlineOf, publicRun, type RunSummary } from "@/lib/log/runs";
import { ctx, pastaNeeds, session } from "./cartFixtures";

const SID = randomUUID();

/** A chat turn of run `sid`, as lib/chat/log.ts stores one. */
const turn = (sid: string, over: Partial<RequestRecord> = {}, meta: Record<string, unknown> = {}): RequestRecord => ({
  id: randomUUID(),
  kind: "agent",
  visitor: "v",
  query: "pasta night for 4, call me on 98765 43210",
  status: "done",
  cached: false,
  latency_ms: 2000,
  cost_usd: 0.004,
  input_tokens: 1000,
  cached_tokens: 600,
  output_tokens: 200,
  model_calls: 1,
  tool_calls: 3,
  catalog_size: 1,
  meta: { chat: true, session_id: sid, reply: "Here's your cart.", summary: "Pasta night for 4", finished_by: "code", ready: false, failed_checks: 1, not_ready: ["checklist: Under ₹600"], ...meta },
  carts: [{ role: "after", position: 0, name: "Pasta", reason: "", total: 640, items: [{ product_id: "p1", qty: 2, price: 100, optional: false, included: true, note: "for the sauce" }] }],
  steps: [
    { kind: "model", name: "agent", ok: true, ms: 1500, input_tokens: 1000, cached_tokens: 600, output_tokens: 200 },
    { kind: "tool", name: "set_needs", ok: false, ms: 3, error: "No such kind: basil" },
  ],
  ...over,
});

const post = (url: string, body: unknown, ip = "1.2.3.4", cookie?: string) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip, ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function setup(over: Partial<OrderDeps> = {}) {
  const log = createMemoryRequestLog();
  const deps: OrderDeps = { limiter: createMemoryLimiter({ perHour: 60, perDay: 1000 }), requestLog: log, ...ctx, ...over };
  return { log, deps };
}

const orderBody = (o: Record<string, unknown> = {}) => ({ order_id: randomUUID(), number: "JH-482913", session_id: SID, session: session(pastaNeeds(), { people: 4 }), messages: 9, ...o });

describe("POST /api/order", () => {
  it("stores the server's own total and lines, not the browser's, and counts the run's messages from the log", async () => {
    const { log, deps } = setup();
    await log.record(turn(SID));
    await log.record(turn(SID));
    const body = orderBody({ total: 1 });
    const res = await handleOrder(post("/api/order", body), deps);
    expect(res.status).toBe(204);
    const [o] = log.orders;
    expect(o.id).toBe(body.order_id);
    expect(o.total).toBeGreaterThan(1);
    expect(o.total).toBe(o.lines.reduce((s, l) => s + l.price * l.qty, 0));
    expect(o.items).toBe(o.lines.length);
    expect(o.messages).toBe(2);
    // The same order id twice is one order.
    await handleOrder(post("/api/order", body), deps);
    expect(log.orders).toHaveLength(1);
  });

  it("falls back to the browser's message count when the log can't count", async () => {
    const { log, deps } = setup();
    deps.requestLog = { ...log, countMessages: async () => Promise.reject(new Error("down")) };
    expect((await handleOrder(post("/api/order", orderBody({ messages: 4 })), deps)).status).toBe(204);
    expect(log.orders[0].messages).toBe(4);
  });

  it("refuses an empty cart, bad ids and bad numbers", async () => {
    const { deps } = setup();
    expect((await handleOrder(post("/api/order", orderBody({ session: session([]) })), deps)).status).toBe(400);
    expect((await handleOrder(post("/api/order", orderBody({ order_id: "x" })), deps)).status).toBe(400);
    expect((await handleOrder(post("/api/order", orderBody({ number: "12" })), deps)).status).toBe(400);
    expect((await handleOrder(post("/api/order", "{"), deps)).status).toBe(400);
  });

  it("answers 429 over the limit and 503 when the log is down", async () => {
    const limited = setup({ limiter: createMemoryLimiter({ perHour: 1, perDay: 100 }) });
    await handleOrder(post("/api/order", orderBody()), limited.deps);
    expect((await handleOrder(post("/api/order", orderBody()), limited.deps)).status).toBe(429);
    const { log, deps } = setup();
    deps.requestLog = { ...log, placeOrder: async () => Promise.reject(new Error("down")) };
    expect((await handleOrder(post("/api/order", orderBody()), deps)).status).toBe(503);
  });
});

describe("POST /api/order/rating", () => {
  async function placed() {
    const s = setup();
    const body = orderBody();
    await handleOrder(post("/api/order", body), s.deps);
    return { ...s, id: body.order_id as string };
  }

  it("saves stars, a comment and a name with phone numbers, emails and links masked, and a second rating replaces the first", async () => {
    const { log, deps, id } = await placed();
    const rate = (b: Record<string, unknown>) => handleOrderRating(post("/api/order/rating", { order_id: id, ...b }), deps);
    expect((await rate({ stars: 2, comment: "  call 98765 43210 or a@b.com, see https://spam.example/x and buy-now.shop  ", name: "Asha" })).status).toBe(204);
    expect(log.orders[0]).toMatchObject({ stars: 2, comment: "call [phone] or [email], see [link] and [link]", name: "Asha" });
    expect((await rate({ stars: 5 })).status).toBe(204);
    expect(log.orders[0]).toMatchObject({ stars: 5, comment: null, name: null });
  });

  it("refuses stars outside 1-5, long text, and orders it doesn't know", async () => {
    const { deps, id } = await placed();
    for (const bad of [{ stars: 0 }, { stars: 6 }, { stars: 3.5 }, { stars: 3, comment: "x".repeat(1001) }, { stars: 3, name: "x".repeat(61) }]) {
      expect((await handleOrderRating(post("/api/order/rating", { order_id: id, ...bad }), deps)).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    expect((await handleOrderRating(post("/api/order/rating", { order_id: randomUUID(), stars: 4 }), deps)).status).toBe(404);
  });

  it("masks links in public text", () => {
    expect(maskPublic("visit www.deals.in/now, mail me@x.io")).toBe("visit [link], mail [email]");
  });
});

describe("runs", () => {
  async function aRun() {
    const { log, deps } = setup();
    const first = turn(SID, { created_at: new Date(Date.now() - 60_000) });
    const second = turn(SID, { latency_ms: 5000, cost_usd: 0.006 }, { ready: true, failed_checks: 0, not_ready: [] });
    await log.record(first);
    await log.record(second);
    await log.record(turn(randomUUID()));
    log.votes.set("x", { request_id: second.id, target: "reply", cart_position: -1, rating: 1, visitor: "a" });
    log.votes.set("y", { request_id: first.id, target: "reply", cart_position: -1, rating: -1, visitor: "a" });
    const body = orderBody();
    await handleOrder(post("/api/order", body), deps);
    await handleOrderRating(post("/api/order/rating", { order_id: body.order_id, stars: 4, comment: "Good", name: "Asha" }), deps);
    return log;
  }

  it("groups turns by run, with totals, votes, the last turn's verdict and the order", async () => {
    const log = await aRun();
    const runs = await log.recentRuns(10);
    expect(runs).toHaveLength(2);
    const r = runs.find((x) => x.session_id === SID)!;
    expect(r).toMatchObject({ turns: 2, model_calls: 2, tool_calls: 6, latency_ms: 7000, slowest_ms: 5000, input_tokens: 2000, code_finished: 2, ready: true, up: 1, down: 1 });
    expect(r.cost_usd).toBeCloseTo(0.01);
    expect(r.order).toMatchObject({ stars: 4, comment: "Good", name: "Asha", messages: 2 });
    expect(headlineOf(runs)).toMatchObject({ runs: 2, ordered: 1, order_rate: 0.5, messages_median: 2, ratings: 1, avg_stars: 4, votes: 2, up: 1 });
  });

  it("keeps everything anyone wrote out of the public view", async () => {
    const log = await aRun();
    const full = (await log.run(SID))!;
    expect(full.turns[0].private?.message).toContain("pasta night");
    expect(full.turns[0].steps[1].private?.error).toBe("No such kind: basil");
    const pub = JSON.stringify(publicRun(full));
    for (const secret of ["pasta night", "[phone]", "Here's your cart", "Pasta night for 4", "Under ₹600", "basil", "for the sauce", '"lines"', '"private"']) {
      expect(pub, secret).not.toContain(secret);
    }
    // The public numbers are all still there.
    expect(publicRun(full).turns[1]).toMatchObject({
      latency_ms: 5000,
      ready: true,
      up: 1,
      steps: [
        { name: "agent", ms: 1500 },
        { name: "set_needs", ok: false },
      ],
    });
    expect(JSON.stringify(publicRun(full).summary)).toContain("Asha");
    expect(await log.run(randomUUID())).toBeNull();
  });

  it("filters runs", () => {
    const run = (o: Partial<RunSummary>): RunSummary => ({
      session_id: randomUUID(),
      started_at: "",
      last_at: "",
      turns: 1,
      model_calls: 1,
      tool_calls: 1,
      latency_ms: 1000,
      slowest_ms: 1000,
      cost_usd: 0.004,
      input_tokens: 0,
      cached_tokens: 0,
      output_tokens: 0,
      code_finished: 0,
      gave_up: 0,
      ready: true,
      up: 0,
      down: 0,
      order: null,
      ...o,
    });
    const order = { number: "JH-1", at: "", total: 1, items: 1, messages: 1, failed_checks: 0, stars: 1, comment: "bad", name: null };
    const runs = [run({ order }), run({ ready: false }), run({ down: 1 }), run({ cost_usd: 0.05, slowest_ms: 30_000 }), run({})];
    expect(filterRuns(runs, "ordered")).toHaveLength(1);
    expect(filterRuns(runs, "not-ordered")).toHaveLength(4);
    expect(filterRuns(runs, "low")).toHaveLength(1);
    expect(filterRuns(runs, "feedback")).toHaveLength(1);
    expect(filterRuns(runs, "problems")).toHaveLength(2);
    expect(filterRuns(runs, "slow")).toEqual([runs[3]]);
    expect(filterRuns(runs, "costly")).toEqual([runs[3]]);
  });
});

describe("the admin key", () => {
  it("matches only the key, and signs cookies that expire and can't be forged", () => {
    expect(keyMatches("s3cret", "s3cret")).toBe(true);
    expect(keyMatches("s3cre", "s3cret")).toBe(false);
    expect(keyMatches("", "")).toBe(false);
    const now = Date.now();
    const t = adminToken("s3cret", now);
    expect(tokenValid(t, "s3cret", now)).toBe(true);
    expect(tokenValid(t, "other", now)).toBe(false);
    expect(tokenValid(t, "s3cret", now + 13 * 3600_000)).toBe(false);
    const [expiry, mac] = t.split(".");
    expect(tokenValid(`${Number(expiry) + 3600_000}.${mac}`, "s3cret", now)).toBe(false);
    expect(tokenValid(undefined, "s3cret", now)).toBe(false);
    expect(tokenValid(t, null, now)).toBe(false);
  });

  it("limits tries per address, and is off without a key", async () => {
    const limiter = createMemoryLimiter({ perHour: 2, perDay: 100 });
    expect(await checkKey("nope", "1.1.1.1", limiter, "k")).toBe("wrong");
    expect(await checkKey("k", "1.1.1.1", limiter, "k")).toBe("ok");
    expect(await checkKey("k", "1.1.1.1", limiter, "k")).toBe("limited");
    expect(await checkKey("k", "2.2.2.2", limiter, null)).toBe("off");
  });
});

describe("the log export", () => {
  it("writes CSV cells safely", () => {
    expect(csvCell('say "hi", then\nleave')).toBe('"say ""hi"", then\nleave"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('\uFEFFa,b\r\n1,"x,y"\r\n');
  });

  it("needs the key or a signed cookie, then sends a zip of every file", async () => {
    const log = createMemoryRequestLog();
    await log.record(turn(SID));
    const deps = { requestLog: log, limiter: createMemoryLimiter({ perHour: 10, perDay: 100 }), key: "k" };
    expect((await handleExport(post("/api/history/export", { key: "no" }), deps)).status).toBe(401);
    expect((await handleExport(post("/api/history/export", {}), deps)).status).toBe(401);
    expect((await handleExport(post("/api/history/export", { key: "k" }), { ...deps, key: null })).status).toBe(404);

    for (const res of [await handleExport(post("/api/history/export", { key: "k" }), deps), await handleExport(post("/api/history/export", {}, "1.2.3.4", `jhola_admin=${adminToken("k")}`), deps)]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="jhola-logs-\d{4}-\d{2}-\d{2}\.zip"/);
      const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
      expect(Object.keys(files).sort()).toEqual(["README.txt", ...Object.keys(EXPORT_FILES)].sort());
      for (const [name, header] of Object.entries(EXPORT_FILES)) {
        expect([...files[name].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 byte-order mark, for Excel
        expect(
          strFromU8(files[name])
            .replace(/^\uFEFF/, "")
            .split("\r\n")[0],
        ).toBe(header.join(","));
      }
      const turns = strFromU8(files["turns.csv"]);
      expect(turns).toContain("pasta night for 4, call me on [phone]");
      expect(strFromU8(files["steps.csv"])).toContain("No such kind: basil");
    }
  });

  it("puts one row per run, turn and step", async () => {
    const log = createMemoryRequestLog();
    await log.record(turn(SID));
    await log.record(turn(SID));
    const files = unzipSync(buildExport(await log.exportLogs(90)));
    const rows = (f: string) =>
      strFromU8(files[f])
        .replace(/^\uFEFF/, "")
        .trim()
        .split("\r\n").length - 1;
    expect([rows("runs.csv"), rows("turns.csv"), rows("steps.csv"), rows("orders.csv")]).toEqual([1, 2, 4, 0]);
  });
});
