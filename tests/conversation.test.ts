import { describe, expect, it } from "vitest";
import type { ChatDone } from "@/lib/chat/api";
import type { Solved } from "@/lib/chat/client";
import { canUndo, chatHistory, conversationReducer as reduce, initialConversation, isBusy, saved, type ConversationState } from "@/lib/chat/conversation";
import { solveSession } from "@/lib/chat/loop";
import { diffCarts } from "@/lib/cart/diff";
import type { Session } from "@/lib/cart/types";
import { ctx, need, session } from "./cartFixtures";

const pasta = session([need("pasta", "pasta", 100, "g", { role: "main" })], { summary: "Pasta night, 4 people" });
const solved = (s: Session, from?: Solved): Solved => {
  const before = from?.cart ?? solveSession(session([]), ctx).cart;
  const r = solveSession(s, ctx);
  return { ...r, diff: diffCarts(before, r.cart), note: [], meta: { ms: 1 } };
};
const done = (s: Session, before?: Solved, o: Partial<ChatDone> = {}): ChatDone => {
  const r = solved(s, before);
  return {
    type: "done",
    status: "done",
    stop_reason: "finished",
    reply: "Your cart is ready.",
    question: null,
    session: r.session,
    cart: r.cart,
    checks: r.checks,
    diff: r.diff,
    note: [],
    pending: null,
    meta: { request_id: "r1" },
    ...o,
  } as unknown as ChatDone;
};

function chat(s: ConversationState, id: number, message: string, result: ChatDone): ConversationState {
  return reduce(reduce(s, { type: "send", id, message }), { type: "chat_done", id, result });
}

describe("conversation reducer", () => {
  it("shows what's arrived while a turn streams, in order, then the result", () => {
    let s = reduce(initialConversation(), { type: "send", id: 1, message: "pasta night" });
    expect(isBusy(s)).toBe(true);
    expect(s.live).toEqual({});
    s = reduce(s, { type: "event", id: 1, event: { type: "brief", brief: pasta.brief } });
    s = reduce(s, { type: "event", id: 1, event: { type: "plan", lines: ["penne 400 g"] } });
    expect(s.live).toMatchObject({ brief: pasta.brief, plan: ["penne 400 g"] });
    s = reduce(s, { type: "event", id: 1, event: { type: "needs", needs: pasta.needs } });
    expect(s.turns[0]).toMatchObject({ planned: 1 });
    s = reduce(s, { type: "chat_done", id: 1, result: done(pasta) });
    expect(s.live).toBeNull();
    expect(isBusy(s)).toBe(false);
    expect(s.now.cart.lines).toHaveLength(1);
    expect(s.flash).toEqual([s.now.cart.lines[0].product.id]);
  });

  it("Undo puts back the snapshot the newest change replaced, only while nothing has changed since", () => {
    const first = done(pasta);
    let s = chat(initialConversation(), 1, "pasta night", first);
    const six = { ...first.session, brief: { ...first.session.brief, people: 6 } };
    const r2 = solved(six, solved(first.session));
    s = reduce(s, { type: "tap", id: 2, text: "6 people", result: r2 });
    const [t1, t2] = s.turns;
    expect(canUndo(s, t1)).toBe(false);
    expect(canUndo(s, t2)).toBe(true);
    s = reduce(s, { type: "undo", id: 2 });
    expect(s.now.session.brief.people).toBe(4);
    expect(s.turns[1].undone).toBe(true);
    // The first turn is the newest change again, and undoable.
    expect(canUndo(s, s.turns[0])).toBe(true);
    // Undoing a turn that isn't the newest change does nothing.
    const s3 = reduce(s, { type: "tap", id: 3, text: "6 people", result: r2 });
    expect(reduce(s3, { type: "undo", id: 1 })).toBe(s3);
  });

  it("a turn that changed nothing isn't an Undo step", () => {
    let s = chat(initialConversation(), 1, "pasta night", done(pasta));
    s = chat(s, 2, "is the pasta right?", done(s.now.session, solved(s.now.session), { reply: "Yes." }));
    expect(s.turns[1].undoTo).toBeUndefined();
    expect(canUndo(s, s.turns[0])).toBe(true);
  });

  it("history leaves out errors, give-ups and undone turns", () => {
    let s = chat(initialConversation(), 1, "pasta night", done(pasta));
    s = reduce(reduce(s, { type: "send", id: 2, message: "boom" }), { type: "chat_error", id: 2, error: "Couldn't reach Jhola." });
    s = chat(s, 3, "do something odd", done(s.now.session, undefined, { status: "gave_up", reply: "I couldn't finish that." }));
    const six = { ...s.now.session, brief: { ...s.now.session.brief, people: 6 } };
    s = chat(s, 4, "for 6", done(six, solved(s.now.session), { reply: "Done: 6 people." }));
    s = reduce(s, { type: "undo", id: 4 });
    expect(chatHistory(s)).toEqual([
      { role: "user", content: "pasta night" },
      { role: "assistant", content: "Your cart is ready." },
    ]);
  });

  it("a big change waits: confirming commits it, declining leaves the cart", () => {
    let s = chat(initialConversation(), 1, "pasta night", done(pasta));
    const before = s.now;
    s = chat(s, 2, "clear it", done(s.now.session, undefined, { status: "confirm", reply: "That's a big change." }));
    expect(s.now).toBe(before);
    const cleared = solved({ ...before.session, needs: [] }, solved(before.session));
    const confirmed = reduce(s, { type: "confirmed", id: 2, result: cleared, diff: cleared.diff });
    expect(confirmed.now.cart.lines).toHaveLength(0);
    expect(canUndo(confirmed, confirmed.turns[1])).toBe(true);
    expect(reduce(s, { type: "declined", id: 2 }).now).toBe(before);
  });

  it("restore drops a turn that was still working, and saving does the same", () => {
    const s = reduce(chat(initialConversation(), 1, "pasta night", done(pasta)), { type: "send", id: 2, message: "more" });
    const kept = saved(s);
    expect(kept.turns.map((t) => t.id)).toEqual([1]);
    const r = reduce(initialConversation(), { type: "restore", now: kept.now, turns: s.turns });
    expect(r.turns.map((t) => t.id)).toEqual([1]);
    expect(r.now.cart.lines).toHaveLength(1);
  });

  it("reset starts over", () => {
    const s = chat(initialConversation(), 1, "pasta night", done(pasta));
    expect(reduce(s, { type: "reset" })).toEqual(initialConversation());
  });
});
