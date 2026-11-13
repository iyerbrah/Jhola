/**
 * Jhola's request log: every shopping-agent turn (lib/chat/log.ts), with its cart before and after and
 * the timing and tokens of each model or tool call ("trace steps"). Older rows from the first
 * version's 3-cart builder (kind "build") stay in the table and in the daily chart. Stored in Postgres when DATABASE_URL
 * is set, and in memory otherwise (your own machine, tests), so /history and /results work either way.
 *
 * Writes happen in the background (logInBackground): a slow or broken database never holds up or
 * breaks a request. Each request is one transaction, so a request is either stored whole or not at all.
 *
 * Phone numbers and email addresses are masked in every record's text before it's stored (maskPii).
 */
import { catalog, catalogIndex } from "../catalog";
import { ensureSchema, getSql, type Sql } from "./db";
import type { CartLineView, OrderRating, OrderRecord, OrderView, RunDetail, RunSummary, StepView, TurnView } from "./runs";

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

/** A shopper's vote on a turn's cart or its reply. Rating 0 takes the vote back. */
export type FeedbackRecord = { request_id: string; target: "cart" | "reply"; cart_position: number; rating: -1 | 0 | 1; visitor: string };
/** "unknown": no such request. "mismatch": not something that can be rated (an old build, a cart that isn't there). */
export type RateResult = "saved" | "cleared" | "unknown" | "mismatch";

/** One vote, for the export. */
export type VoteRow = { request_id: string; target: string; rating: number; at: string | null };

export interface RequestLog {
  record(r: RequestRecord): Promise<void>;
  /** Saves (or takes back) one visitor's vote. Each visitor has at most one vote per cart or reply. */
  rate(f: FeedbackRecord): Promise<RateResult>;
  /** Saves "I'm ready to order". The same order id twice is saved once. */
  placeOrder(o: OrderRecord): Promise<void>;
  /** Saves (or replaces) the shopper's stars, comment and name on an order. */
  rateOrder(r: OrderRating): Promise<"saved" | "unknown">;
  /** How many chat messages a run has had. */
  countMessages(sessionId: string): Promise<number>;
  /** The newest runs, newest first: public numbers only. */
  recentRuns(limit: number): Promise<RunSummary[]>;
  /** One run with everything, private parts included: show it through publicRun() unless the key was given. */
  run(sessionId: string): Promise<RunDetail | null>;
  /** Every run active in the last `days` days, private parts included, and the votes: for the export. */
  exportLogs(days: number, maxRuns?: number): Promise<{ runs: RunDetail[]; votes: VoteRow[] }>;
}

// ---------- Personal details ----------

// Indian mobile numbers: 10 digits starting 6-9, optionally after +91, 0091, 91 or 0, with spaces or hyphens
// between digits ("+91 98765 43210", "098765-43210"). Not inside a longer number or word.
const PHONE = /(?<![\w+])(?:(?:\+|00)?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}(?![\w])/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Masks phone numbers and email addresses: "call 98765 43210" -> "call [phone]". */
export function maskPii(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
}

// Links: http(s)://…, www.…, and bare domains with a common ending ("buy-now.shop/deal").
const LINK_END = String.raw`[^\s.,;:!?)"'\]]`;
const LINK = new RegExp(
  String.raw`\b(?:https?:\/\/|www\.)\S*${LINK_END}|\b[\w-]+(?:\.[\w-]+)*\.(?:com|in|net|org|io|co|xyz|app|dev|me|ly|shop|store|site|online|info|biz)\b(?:\/\S*${LINK_END}|\/)?`,
  "gi",
);

/** For text shown on a public page (a name, a comment): personal details and links masked. */
export function maskPublic(text: string): string {
  return maskPii(text).replace(LINK, "[link]");
}

/** Masks every string inside a value (meta holds the model's reply, assumptions and the like). */
function maskDeep<T>(v: T): T {
  if (typeof v === "string") return maskPii(v) as T;
  if (Array.isArray(v)) return v.map(maskDeep) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)])) as T;
  }
  return v;
}

/** What a store keeps: the record with personal details masked in the query, meta and item notes. */
export function maskRecord(r: RequestRecord): RequestRecord {
  return {
    ...r,
    query: r.query == null ? r.query : maskPii(r.query),
    meta: maskDeep(r.meta),
    carts: r.carts.map((c) => ({ ...c, name: maskPii(c.name), reason: maskPii(c.reason), items: c.items.map((it) => ({ ...it, note: maskPii(it.note) })) })),
  };
}

// ---------- Turning results into records ----------

/** A request that failed before producing an answer. */
export function errorRecord(a: { id: string; kind: "build" | "agent"; visitor: string; query: string; error_kind: string; latency_ms: number; parent_id?: string | null }): RequestRecord {
  return { ...a, status: "error", cached: false, catalog_size: catalog.length, meta: {}, carts: [], steps: [] };
}

type Meta = { chat?: boolean; session_id?: string; reply?: string; summary?: string; finished_by?: string | null };

const isTurn = (r: RequestRecord) => r.kind === "agent" && (r.meta as Meta).chat === true && r.status !== "error";

// ---------- Runs: turns and orders turned into what the History pages show ----------

/** A chat turn as either store reads it back, before it becomes a TurnView. */
type RawTurn = {
  id: string;
  created_at: Date | string;
  status: string;
  stop_reason?: string | null;
  cached: boolean;
  latency_ms: number;
  cost_usd?: number | string | null;
  input_tokens?: number | null;
  cached_tokens?: number | null;
  output_tokens?: number | null;
  model_calls?: number | null;
  tool_calls?: number | null;
  query: string | null;
  meta: Record<string, unknown>;
  steps: (Omit<StepRecord, "attempt"> & { error?: string | null })[];
  cart: { total: number; items: { product_id: string; qty: number; price: number; included: boolean }[] } | null;
  up: number;
  down: number;
};

type RawOrder = OrderRecord & { created_at: Date | string; stars?: number | null; comment?: string | null; name?: string | null };

const iso = (d: Date | string) => new Date(d).toISOString();
const n = (v: number | string | null | undefined) => (v == null ? null : Number(v));

function toTurnView(r: RawTurn): TurnView {
  const m = r.meta as Meta & { ready?: boolean; failed_checks?: number; not_ready?: string[] };
  const steps: StepView[] = r.steps.map((s) => ({
    kind: s.kind,
    name: s.name,
    ok: s.ok,
    ms: s.ms,
    input_tokens: s.input_tokens ?? null,
    cached_tokens: s.cached_tokens ?? null,
    output_tokens: s.output_tokens ?? null,
    private: { error: s.error ?? null },
  }));
  const lines: CartLineView[] = (r.cart?.items ?? []).map((it) => ({
    product_id: it.product_id,
    name: catalogIndex.get(it.product_id)?.name ?? it.product_id,
    qty: it.qty,
    price: it.price,
    included: it.included,
  }));
  return {
    id: r.id,
    at: iso(r.created_at),
    status: r.status,
    stop_reason: r.stop_reason ?? null,
    cached: r.cached,
    finished_by: m.finished_by ?? null,
    latency_ms: r.latency_ms,
    cost_usd: n(r.cost_usd),
    input_tokens: r.input_tokens ?? null,
    cached_tokens: r.cached_tokens ?? null,
    output_tokens: r.output_tokens ?? null,
    model_calls: r.model_calls ?? null,
    tool_calls: r.tool_calls ?? null,
    ready: typeof m.ready === "boolean" ? m.ready : null,
    failed_checks: Number(m.failed_checks ?? 0),
    up: r.up,
    down: r.down,
    cart: r.cart ? { total: r.cart.total, items: r.cart.items.filter((it) => it.included).length } : null,
    steps,
    private: { message: r.query ?? "", reply: m.reply ?? "", not_ready: Array.isArray(m.not_ready) ? m.not_ready : [], lines },
  };
}

function toOrderView(o: RawOrder): OrderView {
  return {
    number: o.number,
    at: iso(o.created_at),
    total: o.total,
    items: o.items,
    messages: o.messages,
    failed_checks: o.failed.length,
    stars: o.stars ?? null,
    comment: o.comment ?? null,
    name: o.name ?? null,
    private: { lines: o.lines.map((l) => ({ ...l, name: catalogIndex.get(l.product_id)?.name ?? l.product_id })), failed: o.failed },
  };
}

/** A run from its turns (oldest first) and its latest order. */
function toRun(sessionId: string, turns: TurnView[], order: OrderView | null, brief: string): RunDetail {
  const times = [...turns.map((t) => t.at), ...(order ? [order.at] : [])].sort();
  const sum = (f: (t: TurnView) => number | null) => turns.reduce((s, t) => s + (f(t) ?? 0), 0);
  const last = turns.at(-1);
  return {
    summary: {
      session_id: sessionId,
      started_at: times[0],
      last_at: times.at(-1)!,
      turns: turns.length,
      model_calls: sum((t) => t.model_calls),
      tool_calls: sum((t) => t.tool_calls),
      latency_ms: sum((t) => t.latency_ms),
      slowest_ms: Math.max(0, ...turns.map((t) => t.latency_ms)),
      cost_usd: sum((t) => t.cost_usd),
      input_tokens: sum((t) => t.input_tokens),
      cached_tokens: sum((t) => t.cached_tokens),
      output_tokens: sum((t) => t.output_tokens),
      code_finished: turns.filter((t) => t.finished_by === "code").length,
      gave_up: turns.filter((t) => t.status === "gave_up").length,
      ready: last?.ready ?? null,
      up: sum((t) => t.up),
      down: sum((t) => t.down),
      order,
    },
    turns,
    private: { brief },
  };
}

/** Runs from raw turns and orders, newest first. */
function buildRuns(turns: RawTurn[], orders: RawOrder[]): RunDetail[] {
  const bySession = new Map<string, { turns: RawTurn[]; order: RawOrder | null }>();
  const slot = (id: string) => bySession.get(id) ?? bySession.set(id, { turns: [], order: null }).get(id)!;
  for (const t of turns) {
    const id = (t.meta as Meta).session_id;
    if (id) slot(id).turns.push(t);
  }
  for (const o of orders) {
    const s = slot(o.session_id);
    if (!s.order || new Date(o.created_at) >= new Date(s.order.created_at)) s.order = o;
  }
  return [...bySession]
    .map(([id, s]) => {
      const sorted = [...s.turns].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
      const brief = [...sorted].reverse().find((t) => (t.meta as Meta).summary)?.meta.summary;
      return toRun(id, sorted.map(toTurnView), s.order ? toOrderView(s.order) : null, typeof brief === "string" ? brief : "");
    })
    .sort((a, b) => b.summary.last_at.localeCompare(a.summary.last_at));
}

// ---------- Stores ----------

/** For your own machine and tests: the newest records in memory, lost on restart. */
export function createMemoryRequestLog(keep = 500): RequestLog & { records: RequestRecord[]; votes: Map<string, FeedbackRecord>; orders: RawOrder[] } {
  const records: RequestRecord[] = [];
  const votes = new Map<string, FeedbackRecord>();
  const orders: RawOrder[] = [];
  const rawTurn = (r: RequestRecord): RawTurn => {
    const v = [...votes.values()].filter((x) => x.request_id === r.id && x.target === "reply");
    const cart = r.carts.find((c) => c.role === "after") ?? r.carts.find((c) => c.role === "before") ?? null;
    return { ...r, created_at: r.created_at ?? new Date(), up: v.filter((x) => x.rating === 1).length, down: v.filter((x) => x.rating === -1).length, cart };
  };
  const runs = () => buildRuns(records.filter(isTurn).map(rawTurn), orders);
  return {
    records,
    votes,
    orders,
    async placeOrder(o) {
      if (orders.some((x) => x.id === o.id)) return;
      orders.unshift({ ...o, created_at: o.created_at ?? new Date() });
      orders.length = Math.min(orders.length, keep);
    },
    async rateOrder(r) {
      const o = orders.find((x) => x.id === r.order_id);
      if (!o) return "unknown";
      Object.assign(o, { stars: r.stars, comment: r.comment, name: r.name });
      return "saved";
    },
    async countMessages(sessionId) {
      return records.filter((r) => isTurn(r) && (r.meta as Meta).session_id === sessionId).length;
    },
    async recentRuns(limit) {
      return runs()
        .slice(0, limit)
        .map((r) => r.summary);
    },
    async run(sessionId) {
      return runs().find((r) => r.summary.session_id === sessionId) ?? null;
    },
    async exportLogs(days, maxRuns = 20_000) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const voteRows = [...votes.values()].map((v) => ({ request_id: v.request_id, target: v.target, rating: v.rating, at: null }));
      return {
        runs: runs()
          .filter((r) => r.summary.last_at >= since)
          .slice(0, maxRuns),
        votes: voteRows,
      };
    },
    async rate(f) {
      const r = records.find((x) => x.id === f.request_id);
      if (!r) return "unknown";
      if (r.kind !== "agent" || (f.target === "cart" && !r.carts.some((c) => c.position === f.cart_position))) return "mismatch";
      const key = `${f.request_id}|${f.target}|${f.cart_position}|${f.visitor}`;
      if (f.rating === 0) {
        votes.delete(key);
        return "cleared";
      }
      votes.set(key, f);
      return "saved";
    },
    async record(r) {
      records.unshift({ ...maskRecord(r), created_at: r.created_at ?? new Date() });
      records.length = Math.min(records.length, keep);
    },
  };
}

/** The newest run ids: sessions with a chat turn or an order, by their last activity. */
async function pgSessionIds(sql: Sql, limit: number, since: Date | null): Promise<string[]> {
  const rows = await sql`
    select sid, max(at) as last
    from (
      select meta ->> 'session_id' as sid, created_at as at from requests
      where kind = 'agent' and meta ->> 'chat' = 'true' and status <> 'error' and meta ? 'session_id'
      union all
      select session_id::text, created_at from orders
    ) x
    group by sid
    having ${since} :: timestamptz is null or max(at) >= ${since}
    order by last desc
    limit ${limit}`;
  return rows.map((r) => r.sid as string);
}

/** The runs with these ids: their turns (with trace steps, cart and votes) and orders, in two round trips. */
async function pgRuns(sql: Sql, ids: string[]): Promise<RunDetail[]> {
  if (!ids.length) return [];
  const turns = await sql`
    select r.id, r.created_at, r.status, r.stop_reason, r.cached, r.latency_ms, r.cost_usd, r.input_tokens, r.cached_tokens,
           r.output_tokens, r.model_calls, r.tool_calls, r.query, r.meta,
           coalesce((select json_agg(json_build_object('kind', s.kind, 'name', s.name, 'ok', s.ok, 'ms', s.ms, 'input_tokens', s.input_tokens,
                       'cached_tokens', s.cached_tokens, 'output_tokens', s.output_tokens, 'error', s.error) order by s.step)
                     from trace_steps s where s.request_id = r.id), '[]') as steps,
           (select json_build_object('total', c.total, 'items',
                     coalesce((select json_agg(json_build_object('product_id', i.product_id, 'qty', i.qty, 'price', i.price, 'included', i.included) order by i.line)
                               from cart_items i where i.cart_id = c.id), '[]'))
              from carts c where c.request_id = r.id order by (c.role = 'after') desc limit 1) as cart,
           (select count(*)::int from feedback f where f.request_id = r.id and f.target = 'reply' and f.rating = 1)  as up,
           (select count(*)::int from feedback f where f.request_id = r.id and f.target = 'reply' and f.rating = -1) as down
    from requests r
    where r.kind = 'agent' and r.meta ->> 'chat' = 'true' and r.status <> 'error' and r.meta ->> 'session_id' in ${sql(ids)}
    order by r.created_at`;
  const orders = await sql`select * from orders where session_id::text in ${sql(ids)} order by created_at`;
  return buildRuns(
    turns as unknown as RawTurn[],
    orders.map((o) => ({ ...(o as unknown as RawOrder), session_id: String(o.session_id) })),
  );
}

export function createPgRequestLog(sql: Sql): RequestLog {
  return {
    async placeOrder(o) {
      await ensureSchema(sql);
      await sql`
        insert into orders (id, number, session_id, request_id, visitor, created_at, total, items, lines, failed, messages)
        values (${o.id}, ${o.number}, ${o.session_id}, ${o.request_id}, ${o.visitor}, ${o.created_at ?? new Date()}, ${o.total}, ${o.items},
                ${sql.json(o.lines as never)}, ${sql.json(o.failed as never)}, ${o.messages})
        on conflict (id) do nothing`;
    },
    async rateOrder(r) {
      await ensureSchema(sql);
      // The order is saved as the popup opens, so a quick rating can arrive a moment before it: look twice.
      for (const wait of [0, 500]) {
        if (wait) await new Promise((res) => setTimeout(res, wait));
        const rows = await sql`update orders set stars = ${r.stars}, comment = ${r.comment}, name = ${r.name}, rated_at = now() where id = ${r.order_id} returning id`;
        if (rows.length) return "saved";
      }
      return "unknown";
    },
    async countMessages(sessionId) {
      await ensureSchema(sql);
      const [row] = await sql`
        select count(*)::int as n from requests
        where kind = 'agent' and meta ->> 'chat' = 'true' and status <> 'error' and meta ->> 'session_id' = ${sessionId}`;
      return row.n;
    },
    async recentRuns(limit) {
      await ensureSchema(sql);
      return (await pgRuns(sql, await pgSessionIds(sql, limit, null))).map((r) => r.summary);
    },
    async run(sessionId) {
      await ensureSchema(sql);
      const [run] = await pgRuns(sql, [sessionId]);
      return run ?? null;
    },
    async exportLogs(days, maxRuns = 20_000) {
      await ensureSchema(sql);
      const since = new Date(Date.now() - days * 86_400_000);
      const runs = await pgRuns(sql, await pgSessionIds(sql, maxRuns, since));
      const votes = await sql`select request_id, target, rating, created_at from feedback where created_at >= ${since} order by created_at`;
      return { runs, votes: votes.map((v) => ({ request_id: String(v.request_id), target: v.target, rating: v.rating, at: iso(v.created_at) })) };
    },
    async rate(f) {
      await ensureSchema(sql);
      // The request is saved in the background, so a vote can arrive a moment before it: look twice.
      let [req] = await sql`select kind from requests where id = ${f.request_id}`;
      if (!req) {
        await new Promise((r) => setTimeout(r, 500));
        [req] = await sql`select kind from requests where id = ${f.request_id}`;
      }
      if (!req) return "unknown";
      if (req.kind !== "agent") return "mismatch";
      if (f.target === "cart") {
        const [cart] = await sql`select 1 from carts where request_id = ${f.request_id} and position = ${f.cart_position}`;
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
    async record(record) {
      await ensureSchema(sql);
      const r = maskRecord(record);
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
