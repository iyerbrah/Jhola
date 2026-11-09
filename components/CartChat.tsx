"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentCart } from "@/lib/agent/carts";
import type { CartChange } from "@/lib/agent/changes";
import { agentRequest, chatHistory, describeChange, describeRequirements, sendAgentTurn, suggestionsFor } from "@/lib/agent/client";
import { catalogIndex } from "@/lib/catalog";
import { rupees } from "./format";

type Turn = {
  id: number;
  message: string;
  state: "working" | "done" | "gave_up" | "error";
  progress?: string;
  reply?: string;
  changes?: CartChange[];
  /** The carts before this turn, for Undo. */
  before?: AgentCart[];
  /** The carts right after it: Undo is offered only while nothing has changed since. */
  after?: string;
  undone?: boolean;
};

type Props = {
  carts: AgentCart[];
  /** The cart the shopper is looking at (phones: the one scrolled to). */
  active: number;
  tiers: string[];
  /** Apply new carts. `changed` lists "cart:product" keys of lines to highlight. */
  onCarts: (carts: AgentCart[], changed: string[]) => void;
};

/** Plain-language changes to a cart, made by the cart helper (lib/agent), with the change list and Undo. */
export function CartChat({ carts, active, tiers, onCarts }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState(active);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const busy = turns.some((t) => t.state === "working");

  // Follow the cart the shopper scrolls to, unless a change is running.
  useEffect(() => {
    if (!busy) setTarget(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  // Leaving the page (or building new carts) cancels a running change.
  useEffect(() => () => abort.current?.abort(), []);

  const update = (id: number, patch: Partial<Turn>) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const id = nextId.current++;
    const before = carts;
    setInput("");
    setTurns((ts) => [...ts, { id, message, state: "working", progress: "Reading your request" }]);
    abort.current = new AbortController();
    const outcome = await sendAgentTurn(agentRequest(carts, target, message, chatHistory(turns)), {
      onStatus: (progress) => update(id, { progress }),
      signal: abort.current.signal,
    });
    if (outcome.kind === "error") {
      const minutes = outcome.retryAfter ? Math.max(1, Math.ceil(outcome.retryAfter / 60)) : null;
      update(id, { state: "error", reply: minutes && outcome.status === 429 ? `${outcome.error} Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` : outcome.error });
      return;
    }
    const r = outcome.result;
    if (r.status !== "done" || r.changes.length === 0) {
      update(id, { state: r.status === "done" ? "done" : "gave_up", reply: r.reply, changes: [] });
      return;
    }
    const changed = r.changes.flatMap((c) => [...c.added.map((a) => `${c.cart - 1}:${a.product_id}`), ...c.qty_changed.map((q) => `${c.cart - 1}:${q.product_id}`)]);
    onCarts(r.carts, changed);
    update(id, { state: "done", reply: r.reply, changes: r.changes, before, after: JSON.stringify(r.carts) });
  }

  function undo(t: Turn) {
    if (!t.before) return;
    onCarts(t.before, []);
    update(t.id, { undone: true });
  }

  const latest = [...turns].reverse().find((t) => t.changes?.length);
  const canUndo = (t: Turn) => t === latest && !t.undone && t.after === JSON.stringify(carts);
  const cart = carts[target];
  const chips = cart ? suggestionsFor(cart, catalogIndex) : [];

  return (
    <section aria-label="Change a cart" className="mt-2 max-w-3xl rounded-3xl border-2 border-ink bg-paper p-5 shadow-lift">
      <h2 className="font-display text-2xl leading-tight">Change a cart</h2>
      <p className="mt-1 text-ink-soft">Say what to change in plain words. Jhola checks every change against the catalog, and you can undo it.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Cart to change">
        <span className="text-sm font-semibold text-ink-soft">Changing:</span>
        {carts.map((c, i) => (
          <button
            key={i}
            type="button"
            disabled={busy}
            onClick={() => setTarget(i)}
            aria-pressed={target === i}
            className={`rounded-full border-2 px-3 py-1 text-sm disabled:cursor-not-allowed ${target === i ? "border-ink bg-ink text-on-ink" : "border-line bg-paper text-ink hover:border-ink"}`}
          >
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: tiers[i] }} aria-hidden />
            {c.name}
          </button>
        ))}
      </div>

      {turns.length > 0 && (
        <ol role="log" aria-label="Changes so far" className="mt-4 space-y-4">
          {turns.map((t) => (
            <li key={t.id}>
              <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-mist px-4 py-2 text-ink">{t.message}</p>
              <div className="mt-2 max-w-[92%]">
                {t.state === "working" ? (
                  <p role="status" className="flex items-center gap-2 text-ink-soft">
                    <span className="skeleton inline-block h-2.5 w-2.5 rounded-full" aria-hidden />
                    {t.progress}…
                  </p>
                ) : t.state === "error" ? (
                  <p role="alert" className="rounded-2xl border-l-4 border-chilli bg-chilli-soft px-4 py-2 text-ink">
                    {t.reply}
                  </p>
                ) : (
                  <>
                    <p className={t.state === "gave_up" ? "text-ink-soft" : "text-ink"}>{t.reply}</p>
                    {t.changes && t.changes.length > 0 && (
                      <div className="mt-2 rounded-2xl bg-chalk px-4 py-3">
                        <ul className="space-y-1.5">
                          {t.changes.map((c) => (
                            <li key={c.cart} className="text-sm">
                              <span className="font-semibold text-ink">{c.name}: </span>
                              <span className="text-ink">{describeChange(c) || "Requirements updated"}</span>
                              {describeRequirements(c) && <span className="block text-ink-soft">{describeRequirements(c)}</span>}
                              <span className="num block font-semibold text-leaf">
                                {rupees(c.total_before)} → {rupees(c.total_after)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {t.undone ? (
                          <p className="mt-2 text-sm text-ink-soft">Undone.</p>
                        ) : (
                          canUndo(t) && (
                            <button type="button" onClick={() => undo(t)} className="mt-2 rounded-xl border-2 border-ink px-3 py-1 text-sm font-bold text-ink hover:bg-mist">
                              Undo
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* On phones the input stays in reach while you scroll the carts. */}
      <div className="sticky bottom-3 z-10 mt-4 -mx-2 rounded-2xl bg-paper px-2 pb-1 pt-2 shadow-[0_-14px_18px_-16px_rgb(18_26_63/0.5)] lg:static lg:mx-0 lg:p-0 lg:shadow-none">
        <div className="mb-2 flex flex-wrap gap-2" aria-label="Suggestions">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              disabled={busy}
              onClick={() => send(c)}
              className="rounded-full border border-line bg-paper px-3 py-1 text-sm text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2 rounded-2xl border-2 border-ink bg-paper p-1.5 shadow-[4px_4px_0_var(--color-marigold)]"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <label htmlFor="cart-chat" className="sr-only">
            What should change in {cart?.name ?? "the cart"}?
          </label>
          <input
            id="cart-chat"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={300}
            autoComplete="off"
            placeholder="e.g. I already have rice"
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-base text-ink placeholder:text-ink-soft focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="shrink-0 rounded-xl bg-ink px-4 py-2 font-bold text-on-ink transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Working…" : "Change"}
          </button>
        </form>
      </div>
    </section>
  );
}
