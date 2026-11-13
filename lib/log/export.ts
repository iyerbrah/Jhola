/**
 * The log export: a zip of CSV files (runs, turns, steps, orders, votes) and a README that says what each
 * column means. Private parts are included: it's only handed out after the admin key
 * (app/api/history/export/route.ts).
 */
import { strToU8, zipSync } from "fflate";
import { checkKey, KEY_MESSAGES, tokenValid } from "../admin";
import { clientIp, json } from "../http";
import type { Limiter } from "../ratelimit";
import type { RunDetail } from "./runs";
import type { VoteRow } from "./requestLog";

type Cell = string | number | boolean | null | undefined;

/** One CSV field: quoted when it holds a comma, quote or line break, with quotes doubled. Formulas are defused. */
export function csvCell(v: Cell): string {
  if (v == null) return "";
  let s = String(v);
  // A spreadsheet runs a cell that starts with = + - @ as a formula: prefix text ones with a quote mark.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A CSV file, starting with a byte-order mark so Excel reads it as UTF-8 (₹, Hindi words). */
export function toCsv(header: string[], rows: Cell[][]): string {
  return "\uFEFF" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const EXPORT_FILES = {
  "runs.csv": [
    "session_id",
    "started_at",
    "last_at",
    "turns",
    "model_calls",
    "tool_calls",
    "latency_ms",
    "slowest_ms",
    "cost_usd",
    "input_tokens",
    "cached_tokens",
    "output_tokens",
    "code_finished",
    "gave_up",
    "ready",
    "up",
    "down",
    "ordered",
    "order_number",
    "order_total",
    "order_items",
    "messages_to_order",
    "stars",
    "comment",
    "name",
    "brief",
  ],
  "turns.csv": [
    "session_id",
    "request_id",
    "at",
    "status",
    "stop_reason",
    "cached",
    "finished_by",
    "latency_ms",
    "cost_usd",
    "input_tokens",
    "cached_tokens",
    "output_tokens",
    "model_calls",
    "tool_calls",
    "ready",
    "failed_checks",
    "not_ready",
    "up",
    "down",
    "cart_total",
    "cart_items",
    "message",
    "reply",
    "cart_lines",
  ],
  "steps.csv": ["session_id", "request_id", "step", "kind", "name", "ok", "ms", "input_tokens", "cached_tokens", "output_tokens", "error"],
  "orders.csv": ["session_id", "number", "at", "total", "items", "messages", "failed_checks", "failed", "stars", "comment", "name", "lines"],
  "votes.csv": ["request_id", "target", "rating", "at"],
} as const;

const README = `Jhola log export

Every run (one shopper's chat, from first message to "I'm ready to order" or leaving) active in the
export's window. Phone numbers and email addresses were masked before anything was stored, and links
too in names and comments. Times are UTC (ISO 8601). Money: cost_usd in US dollars, totals in rupees.

runs.csv    one row per run: totals over its turns, how it ended, its order and rating.
            ready = the cart after the last turn passed every check (lib/cart/ready.ts).
            messages_to_order = chat messages before "I'm ready to order" (taps don't count).
turns.csv   one row per chat turn: what was said, how it ended, cost, tokens, calls, the cart it left.
            not_ready = why the cart wasn't ready to order, joined with " | ".
            cart_lines = JSON [{product_id, name, qty, price, included}].
steps.csv   every model and tool call inside a turn, in order, with its time and tokens.
orders.csv  every "I'm ready to order": the server's own total, checklist failures, the rating.
            lines = JSON [{product_id, qty, price}].
votes.csv   every thumbs up (1) or down (-1) on a reply in the window.
`;

/** The zip's bytes. */
export function buildExport(data: { runs: RunDetail[]; votes: VoteRow[] }, at = new Date()): Uint8Array {
  const runs = data.runs.map((r) => {
    const s = r.summary;
    const o = s.order;
    return [
      s.session_id,
      s.started_at,
      s.last_at,
      s.turns,
      s.model_calls,
      s.tool_calls,
      s.latency_ms,
      s.slowest_ms,
      s.cost_usd,
      s.input_tokens,
      s.cached_tokens,
      s.output_tokens,
      s.code_finished,
      s.gave_up,
      s.ready,
      s.up,
      s.down,
      !!o,
      o?.number,
      o?.total,
      o?.items,
      o?.messages,
      o?.stars,
      o?.comment,
      o?.name,
      r.private?.brief,
    ];
  });
  const turns = data.runs.flatMap((r) =>
    r.turns.map((t) => [
      r.summary.session_id,
      t.id,
      t.at,
      t.status,
      t.stop_reason,
      t.cached,
      t.finished_by,
      t.latency_ms,
      t.cost_usd,
      t.input_tokens,
      t.cached_tokens,
      t.output_tokens,
      t.model_calls,
      t.tool_calls,
      t.ready,
      t.failed_checks,
      t.private?.not_ready.join(" | "),
      t.up,
      t.down,
      t.cart?.total,
      t.cart?.items,
      t.private?.message,
      t.private?.reply,
      JSON.stringify(t.private?.lines ?? []),
    ]),
  );
  const steps = data.runs.flatMap((r) =>
    r.turns.flatMap((t) => t.steps.map((st, i) => [r.summary.session_id, t.id, i + 1, st.kind, st.name, st.ok, st.ms, st.input_tokens, st.cached_tokens, st.output_tokens, st.private?.error])),
  );
  const orders = data.runs
    .filter((r) => r.summary.order)
    .map((r) => {
      const o = r.summary.order!;
      return [r.summary.session_id, o.number, o.at, o.total, o.items, o.messages, o.failed_checks, o.private?.failed.join(" | "), o.stars, o.comment, o.name, JSON.stringify(o.private?.lines ?? [])];
    });
  const votes = data.votes.map((v) => [v.request_id, v.target, v.rating, v.at]);

  const F = EXPORT_FILES;
  const files: Record<string, Uint8Array> = {
    "README.txt": strToU8(`${README}\nExported ${at.toISOString()}: ${data.runs.length} runs.\n`),
    "runs.csv": strToU8(toCsv([...F["runs.csv"]], runs)),
    "turns.csv": strToU8(toCsv([...F["turns.csv"]], turns)),
    "steps.csv": strToU8(toCsv([...F["steps.csv"]], steps)),
    "orders.csv": strToU8(toCsv([...F["orders.csv"]], orders)),
    "votes.csv": strToU8(toCsv([...F["votes.csv"]], votes)),
  };
  return zipSync(files, { level: 6, mtime: at });
}

export const exportName = (at = new Date()) => `jhola-logs-${at.toISOString().slice(0, 10)}.zip`;

// ---------- POST /api/history/export ----------

export type ExportDeps = {
  requestLog: { exportLogs(days: number, maxRuns?: number): Promise<{ runs: RunDetail[]; votes: VoteRow[] }> };
  limiter: Limiter;
  key: string | null;
};

/** The zip, for the admin key in the body ({ key }) or a signed admin cookie. 401, 429 or 503 otherwise. */
export async function handleExport(req: Request, deps: ExportDeps): Promise<Response> {
  const cookie = /(?:^|;\s*)jhola_admin=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  if (!tokenValid(cookie ? decodeURIComponent(cookie) : undefined, deps.key)) {
    let typed = "";
    try {
      typed = String(((await req.json()) as { key?: unknown })?.key ?? "");
    } catch {
      // No body: the cookie was the only way in, and it didn't work.
    }
    const check = await checkKey(typed, clientIp(req), deps.limiter, deps.key);
    if (check !== "ok") return json({ error: KEY_MESSAGES[check] }, check === "limited" ? 429 : check === "off" ? 404 : 401);
  }
  try {
    const at = new Date();
    const zip = buildExport(await deps.requestLog.exportLogs(90, 20_000), at);
    return new Response(zip as unknown as BodyInit, {
      status: 200,
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${exportName(at)}"`, "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[export] couldn't read the log:", err instanceof Error ? err.message : err);
    return json({ error: "Couldn't read the log right now." }, 503);
  }
}
