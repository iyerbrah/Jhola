import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "@/lib/db";
import { percentile } from "@/lib/percentile";
import { createPgRequestLog, type RequestRecord } from "@/lib/requestLog";
import { queryStats, type Stats } from "@/lib/stats";

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === "1" && !url) throw new Error("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL isn't set");

const req = (kind: "build" | "agent", over: Partial<RequestRecord>): RequestRecord => ({
  id: randomUUID(),
  kind,
  visitor: "v1",
  query: "q",
  status: kind === "build" ? "ok" : "done",
  cached: false,
  repaired: false,
  latency_ms: 1000,
  cost_usd: kind === "build" ? 0.01 : 0.002,
  catalog_size: 1,
  meta: {},
  carts: kind === "build" ? [{ role: "result", position: 0, name: "A", reason: "", total: 100, items: [] }] : [],
  steps: [],
  ...over,
});

/** Midnight today in India, as a Date, plus or minus some minutes. */
function indiaMidnight(minutes: number): Date {
  const now = new Date();
  const india = new Date(now.getTime() + 5.5 * 3600_000); // IST is UTC+5:30, no daylight saving
  const midnightUtc = Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate()) - 5.5 * 3600_000;
  return new Date(midnightUtc + minutes * 60_000);
}

describe.skipIf(!url)("stats queries (Postgres)", () => {
  const schema = `t_${randomBytes(6).toString("hex")}`;
  let admin: Sql;
  let sql: Sql;
  let stats: Stats;

  beforeAll(async () => {
    admin = postgres(url!, { onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { onnotice: () => {}, transform: { undefined: null }, connection: { search_path: schema } });
    const log = createPgRequestLog(sql);

    // Fresh builds: one at 00:30 India time today, one at 23:30 yesterday, and one repaired.
    const fresh = [
      req("build", { latency_ms: 1000, visitor: "v1", created_at: indiaMidnight(30), steps: [{ kind: "model", name: "plan", ok: true, ms: 900 }, { kind: "model", name: "cart:1", ok: true, ms: 2000 }] }),
      req("build", { latency_ms: 2000, visitor: "v1", steps: [{ kind: "model", name: "plan", ok: true, ms: 1100 }, { kind: "model", name: "cart:1", ok: false, ms: 50 }] }),
      req("build", { latency_ms: 3000, visitor: "v2", repaired: true }),
      req("build", { latency_ms: 4000, visitor: "v3" }),
      req("build", { latency_ms: 10000, visitor: "v3" }),
      req("build", { latency_ms: 5000, visitor: "v9", created_at: indiaMidnight(-30) }),
    ];
    const cached = [req("build", { cached: true, latency_ms: 10, cost_usd: 0, visitor: "v4" }), req("build", { cached: true, latency_ms: 12, cost_usd: 0, visitor: "v4" })];
    const failed = req("build", { status: "error", error_kind: "timeout", latency_ms: 50000, cost_usd: null, visitor: "v5", carts: [] });
    const turns = [
      req("agent", { latency_ms: 1500, visitor: "v1", steps: [{ kind: "model", name: "gpt-5.4-mini", ok: true, ms: 1400 }, { kind: "tool", name: "swap_item", ok: true, ms: 1 }] }),
      req("agent", { latency_ms: 2500, visitor: "v6" }),
      req("agent", { latency_ms: 3500, visitor: "v6" }),
      req("agent", { latency_ms: 4500, visitor: "v7", status: "gave_up" }),
    ];
    const old = req("build", { latency_ms: 99000, visitor: "v8", created_at: new Date(Date.now() - 40 * 86400_000) });
    for (const r of [...fresh, ...cached, failed, ...turns, old]) await log.record(r);
    await log.rate({ request_id: fresh[1].id, target: "cart", cart_position: 0, rating: 1, visitor: "v1" });
    await log.rate({ request_id: fresh[2].id, target: "cart", cart_position: 0, rating: 1, visitor: "v2" });
    await log.rate({ request_id: fresh[3].id, target: "cart", cart_position: 0, rating: -1, visitor: "v3" });

    stats = await queryStats(sql, 30);
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  it("counts requests in the window only (not the one from 40 days ago)", () => {
    expect(stats.totals).toMatchObject({ requests: 13, builds: 9, fresh_builds: 6, turns: 4 });
  });

  it("gives the same p50 and p95 as the evals' percentile()", () => {
    const fresh = [1000, 2000, 3000, 4000, 10000, 5000];
    const turns = [1500, 2500, 3500, 4500];
    expect(stats.totals.build_p50_ms).toBe(percentile(fresh, 50));
    expect(stats.totals.build_p95_ms).toBe(percentile(fresh, 95));
    expect(stats.totals.turn_p50_ms).toBe(percentile(turns, 50));
    expect(stats.totals.turn_p95_ms).toBe(percentile(turns, 95));
    expect([stats.totals.build_p50_ms, stats.totals.build_p95_ms, stats.totals.turn_p50_ms]).toEqual([3000, 10000, 2500]);
  });

  it("computes the rates over the right requests", () => {
    const t = stats.totals;
    expect(t.error_rate).toBeCloseTo(1 / 13, 6);
    expect(t.give_up_rate).toBeCloseTo(1 / 4, 6);
    expect(t.cache_hit_rate).toBeCloseTo(2 / 8, 6); // failures left out
    expect(t.repair_rate).toBeCloseTo(1 / 6, 6); // fresh builds only
    expect(t.cost_usd).toBeCloseTo(6 * 0.01 + 4 * 0.002, 6);
    expect(t.cost_per_build).toBeCloseTo(0.01, 6);
    expect(t.cost_per_turn).toBeCloseTo(0.002, 6);
  });

  it("buckets days in India time, with every day present, and counts each day's visitors", () => {
    expect(stats.daily).toHaveLength(30);
    const today = stats.daily.at(-1)!;
    const yesterday = stats.daily.at(-2)!;
    expect(today).toMatchObject({ builds: 8, turns: 4, visitors: 7 });
    expect(yesterday).toMatchObject({ builds: 1, turns: 0, visitors: 1 });
    expect(stats.daily.slice(0, -2).every((d) => d.builds === 0 && d.turns === 0)).toBe(true);
    expect(stats.totals.visitors_per_day).toBe(4); // (7 + 1) / 2 days with visits
  });

  it("totals feedback, and times each kind of successful model call", () => {
    expect(stats.feedback).toEqual({ votes: 3, up: 2, on_carts: 3, on_replies: 0 });
    expect(stats.steps.map((s) => [s.step, s.calls, s.avg_ms])).toEqual([
      ["plan", 2, 1000],
      ["cart", 1, 2000],
      ["agent", 1, 1400],
    ]);
  });
});
