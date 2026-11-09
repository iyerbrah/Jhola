import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentTurnResult } from "@/lib/agent/loop";
import { ensureSchema, type Sql } from "@/lib/db";
import { agentRecord, buildRecord, createMemoryRequestLog, createPgRequestLog, errorRecord, type RequestRecord } from "@/lib/requestLog";
import { priceVariants } from "@/lib/price";
import type { BuildCartsResponse } from "@/lib/schema";
import { visitorId } from "@/lib/visitor";
import { biryaniCarts, index as agentIndex } from "./agentFixtures";
import { budget, classic, index, shortcut } from "./fixtures";

const response = (over: Partial<BuildCartsResponse> = {}): BuildCartsResponse => ({
  status: "ok",
  message: "Built for 4.",
  assumptions: ["Assumed 4 people"],
  suggestions: [],
  variants: priceVariants([classic, budget, shortcut], index),
  requirements: { budget_inr: null, item_count: null, item_kind: null, must_include: ["paneer"], diet: null },
  meta: { latency_ms: 4200, model: "gpt-5.4-mini", repaired: true, input_tokens: 62000, cached_tokens: 58000, output_tokens: 1400 },
  ...over,
});

const build = (over: Partial<RequestRecord> = {}): RequestRecord => ({
  ...buildRecord({
    id: randomUUID(),
    visitor: "v1",
    query: "paneer for 4",
    res: response(),
    cached: false,
    steps: [
      { kind: "model", name: "plan", attempt: 1, ok: true, ms: 900, input_tokens: 20000, cached_tokens: 19000, output_tokens: 300 },
      { kind: "model", name: "cart:1", attempt: 2, ok: true, ms: 1500 },
    ],
  }),
  ...over,
});

const turn = (): AgentTurnResult => {
  const before = biryaniCarts();
  const after = [{ ...before[0], items: before[0].items.slice(1) }, before[1], before[2]];
  return {
    status: "done",
    stop_reason: "finished",
    reply: "Removed the chicken.",
    carts: after,
    changes: [{ cart: 1, name: "Budget", removed: [{ product_id: "p002", name: "Chicken", qty: 2 }], added: [], qty_changed: [], requirements: [], total_before: 534, total_after: 114 }],
    meta: { trace_id: "t", finished_by: "code", model: "gpt-5.4-mini", model_calls: 1, tool_calls: 1, latency_ms: 1800, cost_usd: 0.002, input_tokens: 3000, cached_tokens: 2800, output_tokens: 40 },
  };
};

describe("turning results into records", () => {
  it("keeps a build's carts, items, cost and steps, and the answer's text in meta", () => {
    const r = build();
    expect(r).toMatchObject({ kind: "build", status: "ok", cached: false, repaired: true, latency_ms: 4200 });
    expect(r.cost_usd).toBeCloseTo((4000 * 0.75 + 58000 * 0.075 + 1400 * 4.5) / 1e6, 8);
    expect(r.carts.map((c) => c.name)).toEqual(["Classic", "Budget", "Shortcut"]);
    expect(r.carts[0].items[0]).toEqual({ product_id: "p001", qty: 2, price: 95, optional: false, included: true, note: "" });
    expect(r.meta).toMatchObject({ message: "Built for 4.", assumptions: ["Assumed 4 people"] });
    expect(r.steps).toHaveLength(2);
  });

  it("makes a cache hit free", () => {
    const r = buildRecord({ id: randomUUID(), visitor: "v", query: "q", res: response(), cached: true, steps: [] });
    expect(r.cost_usd).toBe(0);
  });

  it("keeps an agent turn's carts before it, and after it only when something changed", () => {
    const r = agentRecord({ id: randomUUID(), parent_id: null, visitor: "v", message: "no chicken", before: biryaniCarts(), result: turn(), steps: [] });
    expect(r.carts.map((c) => `${c.role}:${c.position}`)).toEqual(["before:0", "before:1", "before:2", "after:0", "after:1", "after:2"]);
    expect(r.carts[3].total).toBe(114);
    const unchanged = agentRecord({ id: randomUUID(), parent_id: null, visitor: "v", message: "why?", before: biryaniCarts(), result: { ...turn(), changes: [] }, steps: [] });
    expect(unchanged.carts.map((c) => c.role)).toEqual(["before", "before", "before"]);
  });
});

describe("memory request log", () => {
  it("lists model-built answers newest first, rebuilt with names from the catalog", async () => {
    const log = createMemoryRequestLog(500, index);
    await log.record(build({ query: "first" }));
    await log.record(build({ query: "cached", cached: true }));
    await log.record(errorRecord({ id: randomUUID(), kind: "build", visitor: "v", query: "broken", error_kind: "timeout", latency_ms: 50 }));
    await log.record(build({ query: "second" }));
    const entries = await log.recentBuilds(10);
    expect(entries.map((e) => e.query)).toEqual(["second", "first"]);
    expect(entries[0].variants[0].items[0]).toMatchObject({ name: "Fresh Paneer", brand: "Amul", pack_label: "200 g", line_total: 190 });
    expect(entries[0].meta).toMatchObject({ latency_ms: 4200, repaired: true, model: "gpt-5.4-mini" });
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
    expect(tables.map((t) => t.table_name)).toEqual(["cart_items", "carts", "feedback", "requests", "trace_steps"]);
  });

  it("stores a build with its carts, items and steps, and lists it with names from the catalog", async () => {
    const log = createPgRequestLog(sql, index);
    const r = build({ query: "pg build" });
    await log.record(r);
    const [row] = await sql`select kind, status, cached, cost_usd, meta->>'message' as message from requests where id = ${r.id}`;
    expect(row).toMatchObject({ kind: "build", status: "ok", cached: false, message: "Built for 4." });
    expect(Number(row.cost_usd)).toBeCloseTo(r.cost_usd!, 6);
    const [{ n: items }] = await sql`select count(*)::int as n from cart_items i join carts c on c.id = i.cart_id where c.request_id = ${r.id}`;
    expect(items).toBe(r.carts.reduce((s, c) => s + c.items.length, 0));
    const steps = await sql`select step, name, attempt from trace_steps where request_id = ${r.id} order by step`;
    expect(steps.map((s) => `${s.step}:${s.name}:${s.attempt}`)).toEqual(["1:plan:1", "2:cart:1:2"]);

    const [entry] = await log.recentBuilds(1);
    expect(entry).toMatchObject({ id: r.id, query: "pg build", status: "ok", message: "Built for 4." });
    expect(entry.variants.map((v) => v.name)).toEqual(["Classic", "Budget", "Shortcut"]);
    expect(entry.variants[0].items[0]).toMatchObject({ name: "Fresh Paneer", qty: 2, line_total: 190 });
    expect(entry.cost_usd).toBeCloseTo(r.cost_usd!, 6);
  });

  it("stores an agent turn with its before and after carts and its build as parent", async () => {
    const log = createPgRequestLog(sql, agentIndex);
    const parent = randomUUID();
    const r = agentRecord({ id: randomUUID(), parent_id: parent, visitor: "v", message: "no chicken", before: biryaniCarts(), result: turn(), steps: [{ kind: "tool", name: "remove_item", ok: true, ms: 1 }] });
    await log.record(r);
    const carts = await sql`select role, count(*)::int as n from carts where request_id = ${r.id} group by role order by role`;
    expect(carts.map((c) => `${c.role}:${c.n}`)).toEqual(["after:3", "before:3"]);
    const [row] = await sql`select parent_id, stop_reason, meta->>'finished_by' as finished_by from requests where id = ${r.id}`;
    expect(row).toEqual({ parent_id: parent, stop_reason: "finished", finished_by: "code" });
  });

  it("saves, changes and takes back votes, one per visitor, and refuses unknown or mismatched targets", async () => {
    const log = createPgRequestLog(sql, index);
    const b = build();
    await log.record(b);
    const f = { request_id: b.id, target: "cart" as const, cart_position: 1, visitor: "v1" };
    expect(await log.rate({ ...f, rating: 1 })).toBe("saved");
    expect(await log.rate({ ...f, rating: -1 })).toBe("saved");
    expect(await log.rate({ ...f, visitor: "v2", rating: 1 })).toBe("saved");
    const votes = await sql`select visitor, rating from feedback where request_id = ${b.id} order by visitor`;
    expect(votes.map((v) => `${v.visitor}:${v.rating}`)).toEqual(["v1:-1", "v2:1"]);
    expect(await log.rate({ ...f, rating: 0 })).toBe("cleared");
    const [{ n }] = await sql`select count(*)::int as n from feedback where request_id = ${b.id}`;
    expect(n).toBe(1);
    expect(await log.rate({ ...f, cart_position: 2, rating: 1 })).toBe("saved");
    expect(await log.rate({ ...f, request_id: b.id, target: "reply", cart_position: -1, rating: 1 })).toBe("mismatch");
    expect(await log.rate({ ...f, request_id: randomUUID(), rating: 1 })).toBe("unknown");
  });

  it("stores a request whole or not at all", async () => {
    const log = createPgRequestLog(sql, index);
    const r = build();
    await log.record(r);
    // The same id again fails on the primary key, and none of its carts are left behind.
    await expect(log.record({ ...r, query: "duplicate" })).rejects.toThrow();
    const [{ n }] = await sql`select count(*)::int as n from carts where request_id = ${r.id}`;
    expect(n).toBe(3);
  });
});
