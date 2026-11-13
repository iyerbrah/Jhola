"use client";

import { useEffect, useReducer, useRef } from "react";
import { sendChat, sendSolve, shareLink } from "@/lib/chat/client";
import {
  canUndo as canUndoIn,
  chatHistory,
  conversationReducer,
  initialConversation,
  isBusy,
  nextTurnId,
  saved,
  type Snapshot,
  type TurnView,
} from "@/lib/chat/conversation";
import type { Action } from "@/lib/chat/session";
import type { CartDiff } from "@/lib/cart/diff";
import type { Session } from "@/lib/cart/types";

export type { ChatTurnView, Live, Snapshot, TapTurnView, TurnView } from "@/lib/chat/conversation";

const STORE = "jhola:chat:v1";
/** The run's id: every turn and the order carry it, so History can put them together. */
const RUN = "jhola:run:v1";

const newUuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined);

/** What "I'm ready to order" hands to the thank-you popup. */
export type Placed = { id: string; number: string; total: number; items: number };

/**
 * The whole chat for the page. The state and its rules live in lib/chat/conversation.ts (a pure reducer);
 * this calls the API and dispatches what comes back.
 */
export function useJhola() {
  const [state, dispatch] = useReducer(conversationReducer, undefined, initialConversation);
  // One id per run: kept through a reload (this tab only), and a new one for each new cart.
  const sessionId = useRef<string | undefined>(undefined);
  const runId = () => {
    if (!sessionId.current) {
      sessionId.current = newUuid();
      try {
        if (sessionId.current) sessionStorage.setItem(RUN, sessionId.current);
      } catch {}
    }
    return sessionId.current;
  };
  const lastRequest = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const restored = useRef(false);
  /** The latest state, for callbacks that run after an await. */
  const current = useRef(state);
  current.current = state;
  /** Turn ids are handed out here so two quick taps never share one. */
  const ids = useRef(1);
  const newId = () => {
    ids.current = Math.max(ids.current, nextTurnId(current.current));
    return ids.current++;
  };

  const { now, live, turns, flash } = state;
  const busy = isBusy(state);

  // Keep the chat through a page reload (this tab only), and open a shared cart if one was handed over.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const shared = sessionStorage.getItem("jhola:open");
      if (shared) {
        sessionStorage.removeItem("jhola:open");
        // A shared cart opened here starts a new run.
        sessionStorage.removeItem(RUN);
        const session = JSON.parse(shared) as Session;
        void sendSolve(session, { type: "solve" }).then((r) => r.ok && dispatch({ type: "open", now: snapshot(r.result) }));
        return;
      }
      sessionId.current = sessionStorage.getItem(RUN) ?? undefined;
      const raw = sessionStorage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw) as { now: Snapshot; turns: TurnView[] };
        dispatch({ type: "restore", now: s.now, turns: s.turns });
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(saved(state)));
    } catch {}
  }, [state]);
  useEffect(() => () => abort.current?.abort(), []);
  // A changed line glows for a moment.
  useEffect(() => {
    if (!flash.length) return;
    const t = setTimeout(() => dispatch({ type: "clear_flash" }), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || isBusy(current.current)) return;
    const id = newId();
    const history = chatHistory(current.current);
    const session = current.current.now.session;
    dispatch({ type: "send", id, message });
    abort.current = new AbortController();
    const outcome = await sendChat(
      { session, message, history, session_id: runId(), parent_id: lastRequest.current },
      { signal: abort.current.signal, onEvent: (event) => dispatch({ type: "event", id, event }) },
    );
    if (outcome.kind === "error") return dispatch({ type: "chat_error", id, error: outcome.error });
    lastRequest.current = outcome.result.meta.request_id;
    dispatch({ type: "chat_done", id, result: outcome.result });
  }

  /** Applies a big change the shopper confirmed. */
  async function confirm(turnId: number) {
    const t = current.current.turns.find((x) => x.id === turnId);
    if (!t || t.kind !== "chat" || !t.pending) return;
    const diff = t.pending.diff;
    const r = await sendSolve(t.pending.session, { type: "solve" });
    if (!r.ok) return dispatch({ type: "confirm_failed", id: turnId, error: r.error });
    dispatch({ type: "confirmed", id: turnId, result: r.result, diff });
  }
  const decline = (turnId: number) => dispatch({ type: "declined", id: turnId });

  /** A tap (chip, tick, swap, quantity, remove): applied in code, no model call. */
  async function tap(action: Action, text: string) {
    if (isBusy(current.current)) return;
    const r = await sendSolve(current.current.now.session, action);
    const id = newId();
    if (!r.ok) return dispatch({ type: "tap_error", id, text, error: r.error });
    dispatch({ type: "tap", id, text, result: r.result });
  }

  /** Checkout's stock check: solve again; if anything sold out it's swapped, shown, and undoable. */
  async function recheck(): Promise<CartDiff | null> {
    const r = await sendSolve(current.current.now.session, { type: "solve" });
    if (!r.ok) return null;
    const d = r.result.diff;
    if (!(d.added.length + d.removed.length + d.swapped.length + d.packs.length)) return null;
    dispatch({ type: "recheck", id: newId(), result: r.result });
    return d;
  }

  const undo = (turnId: number) => dispatch({ type: "undo", id: turnId });
  const canUndo = (t: TurnView) => canUndoIn(state, t);

  function stop() {
    abort.current?.abort();
  }

  function reset() {
    abort.current?.abort();
    dispatch({ type: "reset" });
    lastRequest.current = undefined;
    sessionId.current = undefined;
    try {
      sessionStorage.removeItem(STORE);
      sessionStorage.removeItem(RUN);
    } catch {}
  }

  /**
   * "I'm ready to order": logs the order in the background (the server solves the cart again for its own
   * total) and returns what the thank-you popup shows. Saving never holds up the shopper.
   */
  function order(): Placed {
    const { session, cart } = current.current.now;
    const placed: Placed = {
      id: newUuid() ?? "",
      number: `JH-${Math.floor(100000 + Math.random() * 900000)}`,
      total: cart.total,
      items: cart.lines.filter((l) => l.counted).length,
    };
    const session_id = runId();
    const messages = current.current.turns.filter((t) => t.kind === "chat").length;
    if (placed.id && session_id) {
      void fetch("/api/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: placed.id, number: placed.number, session_id, request_id: lastRequest.current, session, messages }),
      }).catch(() => {});
    }
    return placed;
  }

  return {
    now,
    live,
    turns,
    busy,
    flash,
    send,
    tap,
    confirm,
    decline,
    undo,
    canUndo,
    stop,
    reset,
    recheck,
    order,
    share: () => shareLink(now.session),
  };
}

function snapshot(r: { session: Session; cart: Snapshot["cart"]; checks: Snapshot["checks"]; note: string[] }): Snapshot {
  return { session: r.session, cart: r.cart, checks: r.checks, note: r.note };
}
