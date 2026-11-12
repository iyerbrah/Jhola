/**
 * Jhola's request log: every shopping-agent turn (lib/chat/log.ts), with its cart before and after and
 * the timing and tokens of each model or tool call ("trace steps"). Older rows from the 3-cart builder
 * (kind "build") stay in the table and in /stats' history. Stored in Postgres when DATABASE_URL is set, and in memory
 * otherwise (your own machine, tests), so /history and /stats work either way.
 *
 * Writes happen in the background (logInBackground): a slow or broken database never holds up or
 * breaks a request. Each request is one transaction, so a request is either stored whole or not at all.
 *
 * Phone numbers and email addresses are masked in every record's text before it's stored (maskPii).
 */
import { catalog } from "./catalog";
import { ensureSchema, getSql, type Sql } from "./db";

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

/** One chat turn for the /history page: what was asked and answered, the cart it left, and what it cost. */
export type HistoryEntry = {
  id: string;
  at: string;
  session_id: string | null;
  message: string;
  status: string;
  reply: string;
  summary: string;
  /** The cart after the turn (or before it, when nothing changed). */
  total: number | null;
  items: number | null;
  cached: boolean;
  model_calls: number | null;
  tool_calls: number | null;
  latency_ms: number;
  cost_usd: number | null;
  finished_by: string | null;
};

/** A shopper's vote on a turn's cart or its reply. Rating 0 takes the vote back. */
export type FeedbackRecord = { request_id: string; target: "cart" | "reply"; cart_position: number; rating: -1 | 0 | 1; visitor: string };
/** "unknown": no such request. "mismatch": not something that can be rated (an old build, a cart that isn't there). */
export type RateResult = "saved" | "cleared" | "unknown" | "mismatch";

export interface RequestLog {
  record(r: RequestRecord): Promise<void>;
  /** The newest chat turns (errors left out), newest first. */
  recentTurns(limit: number): Promise<HistoryEntry[]>;
  /** Saves (or takes back) one visitor's vote. Each visitor has at most one vote per cart or reply. */
  rate(f: FeedbackRecord): Promise<RateResult>;
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

function toHistoryEntry(r: RequestRecord & { at: string }, cart: Pick<CartRecord, "total" | "items"> | null): HistoryEntry {
  const m = r.meta as Meta;
  return {
    id: r.id,
    at: r.at,
    session_id: m.session_id ?? null,
    message: r.query ?? "",
    status: r.status,
    reply: m.reply ?? "",
    summary: m.summary ?? "",
    total: cart?.total ?? null,
    items: cart ? cart.items.filter((it) => it.included).length : null,
    cached: r.cached,
    model_calls: r.model_calls ?? null,
    tool_calls: r.tool_calls ?? null,
    latency_ms: r.latency_ms,
    cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
    finished_by: m.finished_by ?? null,
  };
}

const isTurn = (r: RequestRecord) => r.kind === "agent" && (r.meta as Meta).chat === true && r.status !== "error";

// ---------- Stores ----------

/** For your own machine and tests: the newest records in memory, lost on restart. */
export function createMemoryRequestLog(keep = 500): RequestLog & { records: RequestRecord[]; votes: Map<string, FeedbackRecord> } {
  const records: RequestRecord[] = [];
  const votes = new Map<string, FeedbackRecord>();
  return {
    records,
    votes,
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
    async recentTurns(limit) {
      return records
        .filter(isTurn)
        .slice(0, limit)
        .map((r) => toHistoryEntry({ ...r, at: (r.created_at ?? new Date()).toISOString() }, r.carts.find((c) => c.role === "after") ?? r.carts.find((c) => c.role === "before") ?? null));
    },
  };
}

export function createPgRequestLog(sql: Sql): RequestLog {
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
    async recentTurns(limit) {
      await ensureSchema(sql);
      // One round trip: each turn with the cart it left (after, else before) as JSON.
      const rows = await sql`
        select r.*, (
                 select json_build_object('total', c.total, 'items',
                          (select coalesce(json_agg(json_build_object('included', i.included)), '[]') from cart_items i where i.cart_id = c.id))
                 from carts c where c.request_id = r.id order by (c.role = 'after') desc limit 1
               ) as cart
        from requests r
        where r.kind = 'agent' and r.meta ->> 'chat' = 'true' and r.status <> 'error'
        order by r.created_at desc
        limit ${limit}`;
      return rows.map((row) => toHistoryEntry({ ...(row as unknown as RequestRecord), carts: [], steps: [], at: new Date(row.created_at).toISOString() }, row.cart));
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
