/**
 * Jhola's request log: every cart build and agent turn, with its carts and the timing and tokens of
 * each model or tool call ("trace steps"). Stored in Postgres when DATABASE_URL is set, and in memory
 * otherwise (your own machine, tests), so /history and /stats work either way.
 *
 * Writes happen in the background (logInBackground): a slow or broken database never holds up or
 * breaks a request. Each request is one transaction, so a request is either stored whole or not at all.
 */
import type { AgentCart } from "./agent/carts";
import type { AgentTurnResult } from "./agent/loop";
import { catalog, catalogIndex, type CatalogIndex } from "./catalog";
import { costUsd } from "./cost";
import { ensureSchema, getSql, type Sql } from "./db";
import { packLabel, type BuildCartsResponse, type PricedVariant } from "./schema";

export type StepRecord = {
  kind: "model" | "tool";
  name: string;
  attempt?: number;
  ok: boolean;
  ms: number;
  input_tokens?: number;
  cached_tokens?: number;
  output_tokens?: number;
  error?: string;
};

export type ItemRecord = { product_id: string; qty: number; price: number; optional: boolean; included: boolean; note: string };
export type CartRecord = { role: "result" | "before" | "after"; position: number; name: string; reason: string; total: number; items: ItemRecord[] };

export type RequestRecord = {
  id: string;
  kind: "build" | "agent";
  created_at?: Date;
  parent_id?: string | null;
  visitor: string;
  query: string | null;
  status: string;
  stop_reason?: string | null;
  error_kind?: string | null;
  cached: boolean;
  repaired?: boolean | null;
  model?: string | null;
  latency_ms: number;
  input_tokens?: number | null;
  cached_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  model_calls?: number | null;
  tool_calls?: number | null;
  catalog_size: number;
  meta: Record<string, unknown>;
  carts: CartRecord[];
  steps: StepRecord[];
};

/** One generation for the /history page: the answer as the shopper saw it, plus when and what it cost. */
export type HistoryEntry = BuildCartsResponse & { id: string; at: string; query: string; cost_usd: number | null };

/** A shopper's vote on one of a build's carts, or on an agent reply. Rating 0 takes the vote back. */
export type FeedbackRecord = { request_id: string; target: "cart" | "reply"; cart_position: number; rating: -1 | 0 | 1; visitor: string };
/** "unknown": no such request. "mismatch": carts are rated on builds, replies on agent turns. */
export type RateResult = "saved" | "cleared" | "unknown" | "mismatch";

export interface RequestLog {
  record(r: RequestRecord): Promise<void>;
  /** The newest builds that called the model (cache hits and errors left out), newest first. */
  recentBuilds(limit: number): Promise<HistoryEntry[]>;
  /** Saves (or takes back) one visitor's vote. Each visitor has at most one vote per cart or reply. */
  rate(f: FeedbackRecord): Promise<RateResult>;
}

const targetKind = { cart: "build", reply: "agent" } as const;

// ---------- Turning results into records ----------

/** A cart build (fresh or from the cache) as a record. */
export function buildRecord(a: { id: string; visitor: string; query: string; res: BuildCartsResponse; steps: StepRecord[]; cached: boolean }): RequestRecord {
  const { res } = a;
  const m = res.meta;
  return {
    id: a.id,
    kind: "build",
    visitor: a.visitor,
    query: a.query,
    status: res.status,
    cached: a.cached,
    repaired: m.repaired,
    model: m.model,
    latency_ms: m.latency_ms,
    input_tokens: m.input_tokens,
    cached_tokens: m.cached_tokens,
    output_tokens: m.output_tokens,
    cost_usd: a.cached ? 0 : costUsd(m.model, m),
    catalog_size: catalog.length,
    meta: { message: res.message, assumptions: res.assumptions, suggestions: res.suggestions, requirements: res.requirements, steps_ms: m.steps_ms },
    carts: res.variants.map((v, position) => ({
      role: "result",
      position,
      name: v.name,
      reason: v.reason,
      total: v.total,
      items: v.items.map((it) => ({ product_id: it.product_id, qty: it.qty, price: it.price, optional: it.optional, included: !it.optional, note: it.note })),
    })),
    steps: a.steps,
  };
}

/** A request that failed before producing an answer. */
export function errorRecord(a: { id: string; kind: "build" | "agent"; visitor: string; query: string; error_kind: string; latency_ms: number; parent_id?: string | null }): RequestRecord {
  return { ...a, status: "error", cached: false, catalog_size: catalog.length, meta: {}, carts: [], steps: [] };
}

const agentCart = (role: CartRecord["role"]) => (c: AgentCart, position: number): CartRecord => ({
  role,
  position,
  name: c.name,
  reason: c.reason,
  total: c.items.reduce((s, it) => (it.included ? s + it.price * it.qty : s), 0),
  items: c.items.map((it) => ({ product_id: it.product_id, qty: it.qty, price: it.price, optional: it.optional, included: it.included, note: it.note })),
});

/** An agent turn: the carts before it, and after it when something changed. */
export function agentRecord(a: { id: string; parent_id: string | null; visitor: string; message: string; before: AgentCart[]; result: AgentTurnResult; steps: StepRecord[] }): RequestRecord {
  const r = a.result;
  const changed = r.changes.length > 0;
  return {
    id: a.id,
    kind: "agent",
    parent_id: a.parent_id,
    visitor: a.visitor,
    query: a.message,
    status: r.status,
    stop_reason: r.stop_reason,
    cached: false,
    model: r.meta.model || null,
    latency_ms: r.meta.latency_ms,
    input_tokens: r.meta.input_tokens,
    cached_tokens: r.meta.cached_tokens,
    output_tokens: r.meta.output_tokens,
    cost_usd: r.meta.cost_usd,
    model_calls: r.meta.model_calls,
    tool_calls: r.meta.tool_calls,
    catalog_size: catalog.length,
    meta: { reply: r.reply, changes: r.changes, finished_by: r.meta.finished_by ?? null },
    carts: [...a.before.map(agentCart("before")), ...(changed ? r.carts.map(agentCart("after")) : [])],
    steps: a.steps,
  };
}

/** Rebuilds the answer the shopper saw from stored carts, taking names and packs from the catalog. */
function toHistoryEntry(
  r: Pick<RequestRecord, "id" | "query" | "status" | "repaired" | "model" | "latency_ms" | "input_tokens" | "cached_tokens" | "output_tokens" | "cost_usd" | "meta"> & { at: string },
  carts: Pick<CartRecord, "name" | "reason" | "total" | "items">[],
  index: CatalogIndex,
): HistoryEntry {
  const meta = r.meta as { message?: string; assumptions?: string[]; suggestions?: string[]; requirements?: BuildCartsResponse["requirements"] };
  const variants: PricedVariant[] = carts.map((c) => ({
    name: c.name,
    reason: c.reason,
    total: c.total,
    items: c.items.map((it) => {
      const p = index.get(it.product_id);
      return {
        product_id: it.product_id,
        name: p?.name ?? it.product_id,
        brand: p?.brand ?? "",
        pack_label: p ? packLabel(p) : "",
        price: it.price,
        qty: it.qty,
        line_total: it.price * it.qty,
        optional: it.optional,
        note: it.note,
        sub_category: p?.sub_category ?? "",
        category: p?.category ?? "snacks",
        tags: p?.tags ?? [],
      };
    }),
  }));
  return {
    id: r.id,
    at: r.at,
    query: r.query ?? "",
    status: r.status as BuildCartsResponse["status"],
    message: meta.message ?? "",
    assumptions: meta.assumptions ?? [],
    suggestions: meta.suggestions ?? [],
    requirements: meta.requirements ?? { budget_inr: null, item_count: null, item_kind: null, must_include: [], diet: null },
    variants,
    cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
    meta: {
      latency_ms: r.latency_ms,
      model: r.model ?? "",
      repaired: !!r.repaired,
      input_tokens: r.input_tokens ?? 0,
      cached_tokens: r.cached_tokens ?? 0,
      output_tokens: r.output_tokens ?? 0,
    },
  };
}

const isHistory = (r: RequestRecord) => r.kind === "build" && !r.cached && r.status !== "error";

// ---------- Stores ----------

/** For your own machine and tests: the newest records in memory, lost on restart. */
export function createMemoryRequestLog(keep = 500, index: CatalogIndex = catalogIndex): RequestLog & { records: RequestRecord[]; votes: Map<string, FeedbackRecord> } {
  const records: RequestRecord[] = [];
  const votes = new Map<string, FeedbackRecord>();
  return {
    records,
    votes,
    async rate(f) {
      const r = records.find((x) => x.id === f.request_id);
      if (!r) return "unknown";
      if (r.kind !== targetKind[f.target] || (f.target === "cart" && !r.carts.some((c) => c.role === "result" && c.position === f.cart_position))) return "mismatch";
      const key = `${f.request_id}|${f.target}|${f.cart_position}|${f.visitor}`;
      if (f.rating === 0) {
        votes.delete(key);
        return "cleared";
      }
      votes.set(key, f);
      return "saved";
    },
    async record(r) {
      records.unshift({ ...r, created_at: r.created_at ?? new Date() });
      records.length = Math.min(records.length, keep);
    },
    async recentBuilds(limit) {
      return records
        .filter(isHistory)
        .slice(0, limit)
        .map((r) => toHistoryEntry({ ...r, at: (r.created_at ?? new Date()).toISOString() }, r.carts.filter((c) => c.role === "result"), index));
    },
  };
}

export function createPgRequestLog(sql: Sql, index: CatalogIndex = catalogIndex): RequestLog {
  return {
    async rate(f) {
      await ensureSchema(sql);
      // The request is saved in the background, so a vote can arrive a moment before it: look twice.
      let [req] = await sql`select kind from requests where id = ${f.request_id}`;
      if (!req) {
        await new Promise((r) => setTimeout(r, 500));
        [req] = await sql`select kind from requests where id = ${f.request_id}`;
      }
      if (!req) return "unknown";
      if (req.kind !== targetKind[f.target]) return "mismatch";
      if (f.target === "cart") {
        const [cart] = await sql`select 1 from carts where request_id = ${f.request_id} and role = 'result' and position = ${f.cart_position}`;
        if (!cart) return "mismatch";
      }
      if (f.rating === 0) {
        await sql`delete from feedback where request_id = ${f.request_id} and target = ${f.target} and cart_position = ${f.cart_position} and visitor = ${f.visitor}`;
        return "cleared";
      }
      await sql`
        insert into feedback (request_id, target, cart_position, rating, visitor)
        values (${f.request_id}, ${f.target}, ${f.cart_position}, ${f.rating}, ${f.visitor})
        on conflict (request_id, target, cart_position, visitor)
        do update set rating = excluded.rating, updated_at = now()`;
      return "saved";
    },
    async record(r) {
      await ensureSchema(sql);
      const { carts, steps, meta, ...row } = r;
      await sql.begin(async (tx) => {
        await tx`insert into requests ${tx({ ...row, created_at: row.created_at ?? new Date(), meta: tx.json(meta as never) })}`;
        for (const c of carts) {
          const { items, ...cart } = c;
          const [{ id: cartId }] = await tx`insert into carts ${tx({ ...cart, request_id: r.id })} returning id`;
          if (items.length) await tx`insert into cart_items ${tx(items.map((it, line) => ({ ...it, cart_id: cartId, line })))}`;
        }
        if (steps.length) {
          const rows = steps.map((s, i) => ({ request_id: r.id, step: i + 1, attempt: 1, ...s }));
          await tx`insert into trace_steps ${tx(rows, "request_id", "step", "kind", "name", "attempt", "ok", "ms", "input_tokens", "cached_tokens", "output_tokens", "error")}`;
        }
      });
    },
    async recentBuilds(limit) {
      await ensureSchema(sql);
      // One round trip: each build with its result carts and their items, as JSON.
      const rows = await sql`
        select r.id, r.created_at, r.query, r.status, r.repaired, r.model, r.latency_ms,
               r.input_tokens, r.cached_tokens, r.output_tokens, r.cost_usd, r.meta,
               coalesce((
                 select json_agg(json_build_object(
                          'name', c.name, 'reason', c.reason, 'total', c.total,
                          'items', (select coalesce(json_agg(json_build_object(
                                      'product_id', i.product_id, 'qty', i.qty, 'price', i.price,
                                      'optional', i.optional, 'included', i.included, 'note', i.note) order by i.line), '[]')
                                    from cart_items i where i.cart_id = c.id)
                        ) order by c.position)
                 from carts c where c.request_id = r.id and c.role = 'result'
               ), '[]') as carts
        from requests r
        where r.kind = 'build' and not r.cached and r.status <> 'error'
        order by r.created_at desc
        limit ${limit}`;
      return rows.map((row) =>
        toHistoryEntry(
          {
            id: row.id,
            at: new Date(row.created_at).toISOString(),
            query: row.query,
            status: row.status,
            repaired: row.repaired,
            model: row.model,
            latency_ms: row.latency_ms,
            input_tokens: row.input_tokens,
            cached_tokens: row.cached_tokens,
            output_tokens: row.output_tokens,
            cost_usd: row.cost_usd == null ? null : Number(row.cost_usd),
            meta: row.meta,
          },
          row.carts,
          index,
        ),
      );
    },
  };
}

// One log per server process, shared by every route (Next gives each route its own copy of this
// module, so a module-level variable would give /api/feedback a different, empty memory log).
const holder = globalThis as unknown as { __jholaRequestLog?: RequestLog };

/** The app's request log: Postgres when DATABASE_URL is set, otherwise in memory. */
export function defaultRequestLog(): RequestLog {
  if (holder.__jholaRequestLog) return holder.__jholaRequestLog;
  const sql = getSql();
  if (!sql) console.warn("[request-log] DATABASE_URL isn't set: keeping requests in memory only.");
  holder.__jholaRequestLog = sql ? createPgRequestLog(sql) : createMemoryRequestLog();
  return holder.__jholaRequestLog;
}

// ---------- Writing without waiting ----------

let failures = 0;
let lastReport = 0;

/** Saves a record in the background. Failures are counted and reported at most once a minute. */
export function logInBackground(log: RequestLog, r: RequestRecord): void {
  log.record(r).catch((err) => {
    failures++;
    const now = Date.now();
    if (now - lastReport < 60_000) return;
    lastReport = now;
    console.error(`[request-log] couldn't save ${failures} request(s) in the last minute:`, err instanceof Error ? err.message : err);
    failures = 0;
  });
}
