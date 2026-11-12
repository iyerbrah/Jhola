import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema, type Sql } from "@/lib/db";
import { chatRecord } from "@/lib/chat/log";
import { solveSession, type ChatTurnResult } from "@/lib/chat/loop";
import { createPgShareStore } from "@/lib/chat/share";
import { diffCarts } from "@/lib/cart/diff";
import { createMemoryRequestLog, createPgRequestLog, errorRecord, maskPii, maskRecord, type RequestRecord } from "@/lib/requestLog";
import { visitorId } from "@/lib/visitor";
import { ctx, pastaNeeds, session } from "./cartFixtures";

const before = solveSession(session(pastaNeeds()), ctx);
const after = solveSession({ ...before.session, brief: { ...before.session.brief, people: 6 } }, ctx);

const result = (over: Partial<ChatTurnResult> = {}): ChatTurnResult => ({
  status: "done",
  stop_reason: "finished",
  reply: "Done: pasta 1 → 2.",
  question: null,
  session: { ...after.session, brief: { ...after.session.brief, summary: "Pasta night, 6 people" } },
  cart: after.cart,
  checks: after.checks,
  diff: diffCarts(before.cart, after.cart),
  note: [],
  pending: null,
  meta: { trace_id: "t", finished_by: "code", model: "gpt-5.4-mini", model_calls: 1, tool_calls: 1, latency_ms: 1800, cost_usd: 0.002, cost_inr: 0.18, steps: [{ kind: "model", name: "gpt-5.4-mini", ok: true, ms: 1500, input_tokens: 9000, cached_tokens: 8000, output_tokens: 120 }, { kind: "tool", name: "update_brief", ok: true, ms: 1 }], input_tokens: 9000, cached_tokens: 8000, output_tokens: 120 },
  ...over,
});

const chat = (over: Partial<RequestRecord> = {}, r: ChatTurnResult = result(), extra: { message?: string; session_id?: string; parent_id?: string | null; cached?: boolean } = {}): RequestRecord => ({
  ...chatRecord({ id: randomUUID(), parent_id: extra.parent_id ?? null, session_id: extra.session_id ?? "s1", visitor: "v1", message: extra.message ?? "make it 6 people", before: before.cart, result: r, cached: extra.cached ?? false }),
  ...over,
});

describe("turning a chat turn into a record", () => {
  it("keeps the cart before and after, the trace, the cost and what was said", () => {
    const r = chat();
    expect(r).toMatchObject({ kind: "agent", status: "done", stop_reason: "finished", cached: false, model_calls: 1, tool_calls: 1, cost_usd: 0.002 });
    expect(r.carts.map((c) => `${c.role}:${c.position}`)).toEqual(["before:0", "after:0"]);
    expect(r.carts[1].total).toBe(after.cart.total);
    expect(r.carts[1].items.find((it) => it.product_id === after.cart.lines[0].product.id)).toMatchObject({ qty: after.cart.lines[0].packs, included: true });
    expect(r.meta).toMatchObject({ chat: true, session_id: "s1", reply: "Done: pasta 1 → 2.", summary: "Pasta night, 6 people", finished_by: "code" });
    expect(r.steps.map((s) => s.name)).toEqual(["gpt-5.4-mini", "update_brief"]);
  });

  it("keeps only the cart before when nothing changed, and makes a cache hit free", () => {
    const same = chat({}, result({ cart: before.cart, diff: diffCarts(before.cart, before.cart) }));
    expect(same.carts.map((c) => c.role)).toEqual(["before"]);
    expect(chat({}, result(), { cached: true })).toMatchObject({ cached: true, cost_usd: 0, steps: [] });
  });
});

describe("memory request log", () => {
  it("lists chat turns newest first, with the cart each one left", async () => {
    const log = createMemoryRequestLog(500);
    await log.record(chat({}, result(), { message: "first" }));
    await log.record(errorRecord({ id: randomUUID(), kind: "agent", visitor: "v", query: "broken", error_kind: "timeout", latency_ms: 50 }));
    await log.record(chat({}, result(), { message: "second" }));
    const entries = await log.recentTurns(10);
    expect(entries.map((e) => e.message)).toEqual(["second", "first"]);
    expect(entries[0]).toMatchObject({ session_id: "s1", status: "done", total: after.cart.total, items: after.cart.lines.filter((l) => l.counted).length, finished_by: "code", summary: "Pasta night, 6 people" });
  });
});

describe("masking personal details", () => {
  it.each([
    ["call me on 9876543210", "call me on [phone]"],
    ["+91 98765 43210 after 6pm", "[phone] after 6pm"],
    ["+91-9876543210", "[phone]"],
    ["919876543210", "[phone]"],
    ["09876543210 is my number", "[phone] is my number"],
    ["0091 98765-43210", "[phone]"],
    ["98765-43210 or 7012345678", "[phone] or [phone]"],
    ["mail ram.iyer+jhola@example.co.in please", "mail [email] please"],
    ["a@b.com and 8123456789", "[email] and [phone]"],
  ])("masks %j", (text, masked) => {
    expect(maskPii(text)).toBe(masked);
  });

  it.each(["paneer for 4 under ₹600", "2 kg atta, 500 g toor dal", "order 12345678901234", "landline 1234567890", "p2744", "5:15PM", "@home snacks"])("leaves %j alone", (text) => {
    expect(maskPii(text)).toBe(text);
  });

  it("masks the message, the reply in meta and item notes, and nothing else", () => {
    const r = chat({ query: "pasta for 4, call 9876543210", meta: { reply: "Sent to a@b.com", summary: "Ring +91 98765 43210", budget: 600 } });
    r.carts[0].items[0].note = "for a@b.com";
    const m = maskRecord(r);
    expect(m.query).toBe("pasta for 4, call [phone]");
    expect(m.meta).toEqual({ reply: "Sent to [email]", summary: "Ring [phone]", budget: 600 });
    expect(m.carts[0].items[0]).toMatchObject({ product_id: r.carts[0].items[0].product_id, note: "for [email]" });
    expect(m.visitor).toBe(r.visitor);
    expect(r.query).toBe("pasta for 4, call 9876543210"); // the caller's record isn't changed
  });

  it("is applied before a record is stored", async () => {
    const log = createMemoryRequestLog(500);
    await log.record(chat({}, result(), { message: "eggs, my email is x@y.in" }));
    await log.record(chat({}, result(), { message: "deliver to 9876543210" }));
    expect(log.records.map((r) => r.query)).toEqual(["deliver to [phone]", "eggs, my email is [email]"]);
    expect((await log.recentTurns(1))[0].message).toBe("deliver to [phone]");
  });
});

describe("visitorId", () => {
  it("is the same for one address on one day, different across days, and never the address", () => {
    const day = new Date("2026-11-09T10:00:00Z");
    const next = new Date("2026-11-10T10:00:00Z");
    expect(visitorId("1.2.3.4", day)).toBe(visitorId("1.2.3.4", day));
    expect(visitorId("1.2.3.4", day)).not.toBe(visitorId("1.2.3.4", next));
    expect(visitorId("1.2.3.4", day)).not.toBe(visitorId("1.2.3.5", day));
    expect(visitorId("1.2.3.4", day)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("counts an IPv6 address by its /64 prefix", () => {
    const day = new Date("2026-11-09T10:00:00Z");
    expect(visitorId("2001:db8:1:2:aaaa::1", day)).toBe(visitorId("2001:db8:1:2:bbbb::9", day));
    expect(visitorId("2001:db8:1:2::1", day)).not.toBe(visitorId("2001:db8:1:3::1", day));
  });
});

// ---------- Against a real Postgres (CI runs one; locally, set TEST_DATABASE_URL to try) ----------

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === "1" && !url) throw new Error("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL isn't set");

describe.skipIf(!url)("Postgres request log", () => {
  // Each run gets its own schema, so tests never touch real data and can run in parallel.
  const schema = `t_${randomBytes(6).toString("hex")}`;
  let admin: Sql;
  let sql: Sql;

  beforeAll(async () => {
    admin = postgres(url!, { onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { onnotice: () => {}, transform: { undefined: null }, connection: { search_path: schema } });
  });
  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  it("creates its tables, and running the schema again changes nothing", async () => {
    await ensureSchema(sql);
    await sql.unsafe((await import("@/lib/db")).SCHEMA);
    const tables = await sql`select table_name from information_schema.tables where table_schema = ${schema} order by 1`;
    expect(tables.map((t) => t.table_name)).toEqual(["cart_items", "carts", "feedback", "requests", "shared_carts", "trace_steps"]);
  });

  it("stores a turn with its carts, items and steps, and lists it", async () => {
    const log = createPgRequestLog(sql);
    const parent = randomUUID();
    const r = chat({}, result(), { message: "pg turn", parent_id: parent });
    await log.record(r);
    const [row] = await sql`select kind, status, parent_id, cost_usd, meta->>'session_id' as session_id, meta->>'finished_by' as finished_by from requests where id = ${r.id}`;
    expect(row).toMatchObject({ kind: "agent", status: "done", parent_id: parent, session_id: "s1", finished_by: "code" });
    expect(Number(row.cost_usd)).toBeCloseTo(0.002, 6);
    const carts = await sql`select role, total from carts where request_id = ${r.id} order by role`;
    expect(carts.map((c) => c.role)).toEqual(["after", "before"]);
    const [{ n: items }] = await sql`select count(*)::int as n from cart_items i join carts c on c.id = i.cart_id where c.request_id = ${r.id}`;
    expect(items).toBe(r.carts.reduce((s, c) => s + c.items.length, 0));
    const steps = await sql`select step, kind, name from trace_steps where request_id = ${r.id} order by step`;
    expect(steps.map((s) => `${s.step}:${s.kind}:${s.name}`)).toEqual(["1:model:gpt-5.4-mini", "2:tool:update_brief"]);

    const [entry] = await log.recentTurns(1);
    expect(entry).toMatchObject({ id: r.id, message: "pg turn", status: "done", total: after.cart.total, session_id: "s1" });
  });

  it("stores the message with phone numbers and emails masked", async () => {
    const log = createPgRequestLog(sql);
    const r = chat({}, result(), { message: "call +91 98765 43210 or a@b.com" });
    await log.record(r);
    const [row] = await sql`select query from requests where id = ${r.id}`;
    expect(row.query).toBe("call [phone] or [email]");
  });

  it("saves, changes and takes back votes, one per visitor, and refuses unknown or mismatched targets", async () => {
    const log = createPgRequestLog(sql);
    const t = chat();
    await log.record(t);
    const f = { request_id: t.id, target: "reply" as const, cart_position: -1, visitor: "v1" };
    expect(await log.rate({ ...f, rating: 1 })).toBe("saved");
    expect(await log.rate({ ...f, rating: -1 })).toBe("saved");
    expect(await log.rate({ ...f, visitor: "v2", rating: 1 })).toBe("saved");
    const votes = await sql`select visitor, rating from feedback where request_id = ${t.id} order by visitor`;
    expect(votes.map((v) => `${v.visitor}:${v.rating}`)).toEqual(["v1:-1", "v2:1"]);
    expect(await log.rate({ ...f, rating: 0 })).toBe("cleared");
    expect(await log.rate({ ...f, target: "cart", cart_position: 0, rating: 1 })).toBe("saved");
    expect(await log.rate({ ...f, target: "cart", cart_position: 2, rating: 1 })).toBe("mismatch");
    expect(await log.rate({ ...f, request_id: randomUUID(), rating: 1 })).toBe("unknown");
  });

  it("stores a request whole or not at all", async () => {
    const log = createPgRequestLog(sql);
    const r = chat();
    await log.record(r);
    // The same id again fails on the primary key, and none of its carts are left behind.
    await expect(log.record({ ...r, query: "duplicate" })).rejects.toThrow();
    const [{ n }] = await sql`select count(*)::int as n from carts where request_id = ${r.id}`;
    expect(n).toBe(2);
  });

  it("saves a shared cart and loads it back", async () => {
    const shares = createPgShareStore(sql);
    const id = await shares.save(after.session);
    expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(await shares.load(id)).toMatchObject({ needs: after.session.needs, brief: { people: 6 } });
    expect(await shares.load("nope")).toBeNull();
  });
});
