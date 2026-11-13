/**
 * The chat's state in the browser: the shopper's snapshot (session, cart, checks), the turns, the Undo
 * stack, and what's arrived so far while a turn streams (the brief, the shopping list, the needs, the
 * cart). A pure reducer with no React and no network, so every rule here (what Undo restores, what the
 * model is told about earlier turns) is unit-tested in node. useJhola calls the API and dispatches.
 */
import type { CartDiff } from "../cart/diff";
import type { Brief, Cart, Check, Need, Session } from "../cart/types";
import type { ChatDone } from "./api";
import type { Solved } from "./client";
import type { ChatTurn } from "./loop";
import { emptySession } from "./session";
import type { ChatEvent } from "./tools";

export type Snapshot = { session: Session; cart: Cart; checks: Check[]; note: string[] };

export type ChatTurnView = {
  id: number;
  kind: "chat";
  message: string;
  state: "working" | "done" | "confirm" | "gave_up" | "error";
  progress: string;
  /** What the agent understood, shown first (a new chat, or when it changed). */
  brief?: Brief;
  planned?: number;
  reply?: string;
  question?: ChatDone["question"];
  diff?: CartDiff;
  note?: string[];
  meta?: ChatDone["meta"];
  pending?: ChatDone["pending"];
  undone?: boolean;
  /** The snapshot this turn replaced, for Undo. */
  undoTo?: number;
};
export type TapTurnView = { id: number; kind: "tap"; text: string; diff: CartDiff; ms: number; undone?: boolean; undoTo?: number; error?: string };
export type TurnView = ChatTurnView | TapTurnView;

/** While a turn streams: what's arrived so far, in order: the brief, the shopping list, the needs, the cart. */
export type Live = { brief?: Brief; plan?: string[]; needs?: Need[]; cart?: Cart; checks?: Check[] };

export type ConversationState = {
  now: Snapshot;
  live: Live | null;
  turns: TurnView[];
  /** Snapshots replaced by a change, oldest first: a turn's undoTo is its place here. */
  stack: Snapshot[];
  /** Product IDs the last change added or changed, for a moment's highlight. */
  flash: string[];
};

export type ConversationAction =
  | { type: "restore"; now: Snapshot; turns: TurnView[] }
  | { type: "open"; now: Snapshot }
  | { type: "send"; id: number; message: string }
  | { type: "event"; id: number; event: ChatEvent }
  | { type: "chat_error"; id: number; error: string }
  | { type: "chat_done"; id: number; result: ChatDone }
  | { type: "confirmed"; id: number; result: Solved; diff: CartDiff }
  | { type: "confirm_failed"; id: number; error: string }
  | { type: "declined"; id: number }
  | { type: "tap"; id: number; text: string; result: Solved }
  | { type: "tap_error"; id: number; text: string; error: string }
  | { type: "undo"; id: number }
  | { type: "clear_flash" }
  | { type: "reset" };

export const EMPTY_CART: Cart = { lines: [], total: 0, budget_inr: null, unmet: [], dropped: [], skipped: [], floor_inr: 0 };
export const blankSnapshot = (): Snapshot => ({ session: emptySession(), cart: EMPTY_CART, checks: [], note: [] });
export const initialConversation = (): ConversationState => ({ now: blankSnapshot(), live: null, turns: [], stack: [], flash: [] });

export const isBusy = (s: ConversationState) => s.turns.some((t) => t.kind === "chat" && t.state === "working");
export const nextTurnId = (s: Pick<ConversationState, "turns">) => Math.max(0, ...s.turns.map((t) => t.id)) + 1;

const snapshotOf = (r: Pick<Solved, "session" | "cart" | "checks" | "note">): Snapshot => ({ session: r.session, cart: r.cart, checks: r.checks, note: r.note });
const isEmpty = (d: CartDiff) => d.added.length + d.removed.length + d.swapped.length + d.packs.length === 0;
const noDiff = (total: number): CartDiff => ({ added: [], removed: [], swapped: [], packs: [], total_before: total, total_after: total });
const flashOf = (d: CartDiff) => [...d.added.map((a) => a.product_id), ...d.swapped.map((s) => s.to.product_id), ...d.packs.map((p) => p.product_id)];

/** Makes `next` current, keeping the old snapshot for Undo. Returns the state and the old one's place. */
function commit(s: ConversationState, next: Snapshot, diff: CartDiff | undefined): [ConversationState, number] {
  return [{ ...s, stack: [...s.stack, s.now], now: next, flash: diff ? flashOf(diff) : s.flash }, s.stack.length];
}

function patchChat(s: ConversationState, id: number, patch: Partial<ChatTurnView>): ConversationState {
  return { ...s, turns: s.turns.map((t) => (t.id === id && t.kind === "chat" ? { ...t, ...patch } : t)) };
}

export function conversationReducer(s: ConversationState, a: ConversationAction): ConversationState {
  switch (a.type) {
    case "restore":
      // A turn that was still working when the page went away never finished: leave it out.
      return { ...s, now: a.now, turns: a.turns.filter((t) => t.kind === "tap" || t.state !== "working"), stack: [], live: null };
    case "open":
      return { ...s, now: a.now };
    case "send":
      return { ...s, live: {}, turns: [...s.turns, { id: a.id, kind: "chat", message: a.message, state: "working", progress: "Reading your request" }] };
    case "event": {
      const e = a.event;
      const live = s.live ?? {};
      if (e.type === "status") return patchChat(s, a.id, { progress: e.text });
      if (e.type === "brief") return { ...patchChat(s, a.id, { brief: e.brief }), live: { ...live, brief: e.brief } };
      if (e.type === "plan") return { ...patchChat(s, a.id, { progress: "Writing the shopping list" }), live: { ...live, plan: e.lines } };
      if (e.type === "needs") return { ...patchChat(s, a.id, { planned: e.needs.filter((n) => n.ticked).length }), live: { ...live, needs: e.needs } };
      return { ...s, live: { ...live, cart: e.cart, checks: e.checks } };
    }
    case "chat_error":
      return { ...patchChat(s, a.id, { state: "error", reply: a.error }), live: null };
    case "chat_done": {
      const r = a.result;
      let next: ConversationState = { ...s, live: null };
      const patch: Partial<ChatTurnView> = { state: r.status, reply: r.reply, question: r.question, diff: r.diff, note: r.note, meta: r.meta, pending: r.pending };
      if (r.status === "done") {
        const changed = !isEmpty(r.diff) || r.session.brief.summary !== s.now.session.brief.summary;
        if (changed) [next, patch.undoTo] = commit(next, snapshotOf(r), r.diff);
        else next = { ...next, now: snapshotOf(r) };
      }
      return patchChat(next, a.id, patch);
    }
    case "confirmed": {
      const [next, undoTo] = commit(s, snapshotOf(a.result), a.diff);
      return patchChat(next, a.id, { state: "done", reply: "Done. I've made that change.", diff: a.diff, pending: null, undoTo, note: a.result.note });
    }
    case "confirm_failed": {
      const t = s.turns.find((x) => x.id === a.id);
      return patchChat(s, a.id, { reply: `${t && t.kind === "chat" ? t.reply : ""} ${a.error}`.trim() });
    }
    case "declined":
      return patchChat(s, a.id, { state: "done", reply: "Okay, I've left your cart as it was.", pending: null, diff: undefined });
    case "tap": {
      const [next, undoTo] = commit(s, snapshotOf(a.result), a.result.diff);
      return { ...next, turns: [...next.turns, { id: a.id, kind: "tap", text: a.text, diff: a.result.diff, ms: a.result.meta.ms, undoTo }] };
    }
    case "tap_error":
      return { ...s, turns: [...s.turns, { id: a.id, kind: "tap", text: a.text, diff: noDiff(s.now.cart.total), ms: 0, error: a.error }] };
    case "undo": {
      const t = s.turns.find((x) => x.id === a.id);
      if (!t || !canUndo(s, t)) return s;
      return { ...s, now: s.stack[t.undoTo!], stack: s.stack.slice(0, t.undoTo), turns: s.turns.map((x) => (x.id === a.id ? { ...x, undone: true } : x)) };
    }
    case "clear_flash":
      return s.flash.length ? { ...s, flash: [] } : s;
    case "reset":
      return initialConversation();
  }
}

/** Undo is offered on the newest change only, while nothing has changed since. */
export function canUndo(s: ConversationState, t: TurnView): boolean {
  if (t.undoTo == null || t.undoTo < 0 || t.undone) return false;
  const latest = [...s.turns].reverse().find((x) => x.undoTo != null && x.undoTo >= 0 && !x.undone);
  return t.id === latest?.id && t.undoTo === s.stack.length - 1;
}

/**
 * Earlier turns the model is told about: what the shopper asked and what Jhola said. Errors, give-ups and
 * undone turns are left out: none of them is what the cart now reflects.
 */
export function chatHistory(s: Pick<ConversationState, "turns">, max = 6): ChatTurn[] {
  return s.turns
    .flatMap((t) =>
      t.kind === "chat" && t.reply && t.state !== "error" && t.state !== "gave_up" && t.state !== "working" && !t.undone
        ? [
            { role: "user" as const, content: t.message },
            { role: "assistant" as const, content: t.reply },
          ]
        : [],
    )
    .slice(-max);
}

/** What's saved through a reload: the snapshot and the finished turns. */
export function saved(s: ConversationState): { now: Snapshot; turns: TurnView[] } {
  return { now: s.now, turns: s.turns.filter((t) => t.kind === "tap" || t.state !== "working").slice(-30) };
}
