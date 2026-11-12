"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { changeParts } from "@/lib/chat/client";
import type { CartDiff } from "@/lib/cart/diff";
import { Feedback } from "../Feedback";
import { rupees } from "../format";
import type { ChatTurnView, TurnView } from "./useJhola";

type Props = {
  turns: TurnView[];
  busy: boolean;
  canUndo: (t: TurnView) => boolean;
  onSend: (text: string) => void;
  onUndo: (id: number) => void;
  onStop: () => void;
  onConfirm: (id: number) => void;
  onDecline: (id: number) => void;
  onTrace: (t: ChatTurnView) => void;
  chips: string[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

/** The conversation: each message, what Jhola understood and did, and the box to say what's next. */
export function ChatPanel({ turns, busy, canUndo, onSend, onUndo, onStop, onConfirm, onDecline, onTrace, chips, inputRef }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const last = turns.at(-1);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [last]);

  return (
    <section aria-label="Chat with Jhola" className="flex flex-col">
      {turns.length === 0 && (
        <div className="flex gap-3">
          <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-marigold font-display text-lg text-ink">
            J
          </span>
          <p className="text-ink">Here&apos;s your cart. Tell me what to change: more people, a budget, no onions, other brands, anything. Or tap the cart to change it yourself.</p>
        </div>
      )}
      <ol className="space-y-5" aria-live="polite">
        {turns.map((t) =>
          t.kind === "tap" ? (
            <li key={t.id} className="text-center text-sm text-ink-soft">
              {t.error ? (
                <span className="text-chilli">{t.error}</span>
              ) : (
                <>
                  <span className="font-semibold text-ink">{t.text}</span>
                  {t.diff.total_before !== t.diff.total_after && (
                    <span className="num">
                      {" "}
                      · {rupees(t.diff.total_before)} → {rupees(t.diff.total_after)}
                    </span>
                  )}
                  <span> · no AI call, {t.ms < 1 ? "<1" : Math.round(t.ms)} ms</span>
                  {t.undone ? (
                    <span> · undone</span>
                  ) : (
                    canUndo(t) && (
                      <>
                        {" · "}
                        <button type="button" onClick={() => onUndo(t.id)} className="font-semibold text-ink underline underline-offset-4">
                          Undo
                        </button>
                      </>
                    )
                  )}
                </>
              )}
            </li>
          ) : (
            <li key={t.id} className="space-y-2">
              <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2 text-on-ink">{t.message}</p>
              <AgentTurn t={t} canUndo={canUndo(t)} onUndo={() => onUndo(t.id)} onSend={onSend} onConfirm={() => onConfirm(t.id)} onDecline={() => onDecline(t.id)} onTrace={() => onTrace(t)} onStop={onStop} busy={busy} />
            </li>
          ),
        )}
      </ol>
      <div ref={end} />
      <Composer busy={busy} onSend={onSend} chips={busy ? [] : chips} inputRef={inputRef} />
    </section>
  );
}

function AgentTurn({ t, canUndo, onUndo, onSend, onConfirm, onDecline, onTrace, onStop, busy }: { t: ChatTurnView; canUndo: boolean; onUndo: () => void; onSend: (s: string) => void; onConfirm: () => void; onDecline: () => void; onTrace: () => void; onStop: () => void; busy: boolean }) {
  return (
    <div className="flex gap-3">
      <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-marigold font-display text-lg text-ink">
        J
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {t.brief?.summary && (
          <p className="w-fit rounded-xl border border-marigold bg-marigold-soft px-3 py-1.5 text-sm text-marigold-text">
            <span className="font-semibold">I understood:</span> {t.brief.summary}
            {t.brief.assumptions.length > 0 && <span className="block text-xs">{t.brief.assumptions.join(" · ")}</span>}
          </p>
        )}

        {t.state === "working" && (
          <p role="status" className="flex items-center gap-2 text-ink-soft">
            <span className="skeleton inline-block h-2.5 w-2.5 rounded-full" aria-hidden />
            {t.progress}
            {t.planned ? <span>· {t.planned} items planned</span> : null}
            <button type="button" onClick={onStop} className="ml-2 text-sm underline underline-offset-4 hover:text-ink">
              Stop
            </button>
          </p>
        )}

        {t.reply && <p className={t.state === "error" || t.state === "gave_up" ? "text-chilli" : "text-ink"}>{t.reply}</p>}

        {t.state === "confirm" && t.pending && (
          <div className="rounded-2xl border-2 border-ink bg-paper px-4 py-3">
            <DiffList d={t.pending.diff} />
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={onConfirm} className="rounded-xl bg-ink px-4 py-2 font-bold text-on-ink hover:bg-ink-deep">
                Yes, make the change
              </button>
              <button type="button" onClick={onDecline} className="rounded-xl border-2 border-ink px-4 py-2 font-semibold text-ink hover:bg-mist">
                Keep my cart
              </button>
            </div>
          </div>
        )}

        {t.question && t.state === "done" && (
          <div className="flex flex-wrap gap-2" aria-label={t.question.question}>
            <span className="sr-only">{t.question.question}</span>
            {t.question.options.map((o) => (
              <button key={o} type="button" disabled={busy} onClick={() => onSend(o)} className="rounded-full border-2 border-ink bg-paper px-3 py-1 text-sm font-semibold text-ink hover:bg-mist disabled:opacity-40">
                {o}
              </button>
            ))}
          </div>
        )}

        {t.state === "done" && t.diff && hasChanges(t.diff) && t.meta && t.diff.total_before > 0 && (
          <div className="rounded-2xl bg-chalk px-4 py-3">
            <DiffList d={t.diff} />
            {t.undone ? <p className="mt-2 text-sm text-ink-soft">Undone.</p> : canUndo && (
              <button type="button" onClick={onUndo} className="mt-2 rounded-xl border-2 border-ink px-3 py-1 text-sm font-bold text-ink hover:bg-mist">
                Undo
              </button>
            )}
          </div>
        )}

        {t.note && t.note.length > 0 && t.state === "done" && (
          <ul className="space-y-0.5 border-l-2 border-line pl-3 text-sm text-ink-soft" aria-label="Notes">
            {t.note.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}

        {t.meta && t.state !== "working" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" onClick={onTrace} className="num text-xs text-ink-soft underline decoration-line underline-offset-4 hover:text-ink">
              {t.meta.cached ? "From the answer cache" : `${t.meta.model_calls === 0 ? "Answered" : "Built"} in ${(t.meta.latency_ms / 1000).toFixed(1)} s`} · {t.meta.model_calls + t.meta.tool_calls} steps · {t.meta.cost_inr != null ? `₹${t.meta.cost_inr.toFixed(2)}` : "–"} to run
            </button>
            <Feedback key={t.meta.request_id} requestId={t.meta.request_id} target="reply" label="Helpful?" />
          </div>
        )}
      </div>
    </div>
  );
}

const hasChanges = (d: CartDiff) => d.added.length + d.removed.length + d.swapped.length + d.packs.length > 0;

function DiffList({ d }: { d: CartDiff }) {
  const parts = changeParts(d);
  return (
    <div className="text-sm">
      <ul className="space-y-0.5">
        {parts.map((p) => (
          <li key={`${p.sign}${p.text}`} className={p.sign === "+" ? "text-leaf" : p.sign === "−" ? "text-chilli" : "text-ink"}>
            <span className="num mr-1 font-bold" aria-hidden>
              {p.sign === "~" ? "↻" : p.sign}
            </span>
            {p.text}
          </li>
        ))}
      </ul>
      <p className="num mt-1.5 font-semibold text-ink">
        {rupees(d.total_before)} → {rupees(d.total_after)}
      </p>
    </div>
  );
}

function Composer({ busy, onSend, chips, inputRef }: { busy: boolean; onSend: (s: string) => void; chips: string[]; inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
  };
  return (
    <div className="sticky bottom-0 -mx-4 mt-5 bg-chalk/95 px-4 pb-4 pt-2 backdrop-blur sm:mx-0 sm:px-0">
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" aria-label="Suggestions">
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => onSend(c)} className="rounded-full border border-line bg-paper px-3 py-1 text-sm text-ink-soft hover:border-ink hover:text-ink">
              {c}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2 rounded-2xl border-2 border-ink bg-paper p-1.5 shadow-[5px_5px_0_var(--color-marigold)]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="ask" className="sr-only">
          What should Jhola change?
        </label>
        <textarea
          id="ask"
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={busy ? "Jhola is working…" : "Ask for any change…"}
          className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-lg text-ink placeholder:text-ink-soft focus:outline-none"
        />
        <button type="submit" disabled={busy || !text.trim()} className="shrink-0 rounded-xl bg-ink px-4 py-2 font-bold text-on-ink hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  );
}
