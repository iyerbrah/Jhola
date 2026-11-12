/**
 * The browser side of the shopping agent: sends a turn to /api/chat and reads the streamed JSON lines,
 * sends taps to /api/solve, makes share links and the plain-text list. No React here, so it's unit-tested.
 */
import { amountLabel, type Cart, type Check, type Session } from "../cart/types";
import type { CartDiff } from "../cart/diff";
import type { ChatDone, ChatStreamEvent } from "./api";
import type { ChatTurn } from "./loop";
import type { Action } from "./session";
import type { ChatEvent } from "./tools";

export type ChatOutcome = { kind: "done"; result: ChatDone } | { kind: "error"; error: string; status: number; retryAfter?: number };

export type ChatRequest = { session: Session; message: string; history: ChatTurn[]; session_id?: string; parent_id?: string };

/** Reads a streamed turn: calls onEvent for each progress line, and resolves with the result. */
export async function readChatStream(res: Response, onEvent: (e: ChatEvent) => void): Promise<ChatOutcome> {
  if (!res.body) return { kind: "error", error: "No reply from Jhola. Please try again.", status: res.status };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line: string): ChatOutcome | null => {
    if (!line.trim()) return null;
    let e: ChatStreamEvent;
    try {
      e = JSON.parse(line);
    } catch {
      return null;
    }
    if (e.type === "done") return { kind: "done", result: e };
    if (e.type === "error") return { kind: "error", error: e.error, status: 200 };
    onEvent(e);
    return null;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const outcome = handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (outcome) return outcome;
    }
  }
  return handle(buffer) ?? { kind: "error", error: "The reply was cut off, so your cart wasn't changed. Please try again.", status: 200 };
}

async function errorOf(res: Response): Promise<{ error: string; retryAfter?: number }> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; retry_after?: number };
  const minutes = body.retry_after ? Math.max(1, Math.ceil(body.retry_after / 60)) : null;
  const error = body.error ?? "Something went wrong. Please try again.";
  return { error: res.status === 429 && minutes ? `${error} Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` : error, retryAfter: body.retry_after };
}

export async function sendChat(body: ChatRequest, { onEvent, signal, fetchImpl = fetch }: { onEvent: (e: ChatEvent) => void; signal?: AbortSignal; fetchImpl?: typeof fetch }): Promise<ChatOutcome> {
  let res: Response;
  try {
    res = await fetchImpl("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, history: body.history.slice(-6) }), signal });
  } catch {
    return { kind: "error", error: "Couldn't reach Jhola. Check your connection and try again.", status: 0 };
  }
  if (!res.ok) return { kind: "error", status: res.status, ...(await errorOf(res)) };
  return readChatStream(res, onEvent);
}

export type Solved = { session: Session; cart: Cart; checks: Check[]; diff: CartDiff; note: string[]; meta: { ms: number } };

export async function sendSolve(session: Session, action: Action, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; result: Solved } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl("/api/solve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session, action }) });
    if (!res.ok) return { ok: false, error: (await errorOf(res)).error };
    return { ok: true, result: await res.json() };
  } catch {
    return { ok: false, error: "Couldn't reach Jhola. Check your connection and try again." };
  }
}

export async function shareLink(session: Session, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session }) });
    if (!res.ok) return { ok: false, error: (await errorOf(res)).error };
    return { ok: true, path: (await res.json()).path };
  } catch {
    return { ok: false, error: "Couldn't reach Jhola. Check your connection and try again." };
  }
}

/** The cart as plain text, for "Copy list": one line per item and the total. */
export function listText(session: Session, cart: Cart): string {
  const counted = cart.lines.filter((l) => l.counted);
  const lines = counted.map((l) => `- ${l.packs} × ${l.product.brand} ${l.product.name}, ${l.product.pack_label}: ₹${l.line_total}`);
  const title = session.brief.summary || "My cart";
  return [`${title} (Jhola)`, ...lines, `Total: ₹${cart.total} for ${counted.length} item${counted.length === 1 ? "" : "s"}`].join("\n");
}

/** "+2 × Penne, −Fresh Cream, ₹612 → ₹745" pieces for the change list. */
export function changeParts(d: CartDiff): { sign: "+" | "−" | "~"; text: string }[] {
  return [
    ...d.added.map((r) => ({ sign: "+" as const, text: `${r.packs > 1 ? `${r.packs} × ` : ""}${r.name}` })),
    ...d.removed.map((r) => ({ sign: "−" as const, text: r.name })),
    ...d.swapped.map((s) => ({ sign: "~" as const, text: `${s.from.name} → ${s.to.name}` })),
    ...d.packs.map((p) => ({ sign: "~" as const, text: `${p.name} ${p.from} → ${p.to}` })),
  ];
}

/** "400 g for 4" */
export function neededLabel(amount: number, unit: "g" | "ml" | "pcs", people: number | null): string {
  return `${amountLabel(amount, unit)}${people ? ` for ${people}` : ""}`;
}
