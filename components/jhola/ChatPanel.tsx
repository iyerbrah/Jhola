"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { changeParts } from "@/lib/chat/client";
import type { CartDiff } from "@/lib/cart/diff";
import { Feedback } from "./Feedback";
import { rupees, rupeesExact, secs } from "../format";
import { button, chip, PANEL } from "../ui";
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
          <Mark />
          <p className="text-[1.0625rem] leading-relaxed text-ink">
            Here&apos;s your cart. Tell me what to change: more people, a budget, no onions, other brands, anything. Or tap the cart to change it yourself.
          </p>
        </div>
      )}
      <ol className="space-y-6" aria-live="polite">
        {turns.map((t) =>
          t.kind === "tap" ? (
            <li key={t.id} className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 border-y border-dashed border-line py-2 text-center text-sm text-ink-soft">
              {t.error ? (
                <span className="text-chilli">{t.error}</span>
              ) : (
                <>
                  <span className="font-semibold text-ink">{t.text}</span>
                  {t.diff.total_before !== t.diff.total_after && (
                    <span className="num">
                      {rupees(t.diff.total_before)} → {rupees(t.diff.total_after)}
                    </span>
                  )}
                  <span>No model call, {t.ms < 1 ? "under 1" : Math.round(t.ms)} ms</span>
                  {t.undone ? (
                    <span>Undone</span>
                  ) : (
                    canUndo(t) && (
                      <button type="button" onClick={() => onUndo(t.id)} className={button("quiet")}>
                        Undo
                      </button>
                    )
                  )}
                </>
              )}
            </li>
          ) : (
            <li key={t.id} className="space-y-3">
              <p className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-sign px-4 py-2.5 text-[1.0625rem] leading-snug text-on-sign">{t.message}</p>
              <AgentTurn
                t={t}
                canUndo={canUndo(t)}
                onUndo={() => onUndo(t.id)}
                onSend={onSend}
                onConfirm={() => onConfirm(t.id)}
                onDecline={() => onDecline(t.id)}
                onTrace={() => onTrace(t)}
                onStop={onStop}
                busy={busy}
              />
            </li>
          ),
        )}
      </ol>
      <div ref={end} />
      <Composer busy={busy} onSend={onSend} chips={busy ? [] : chips} inputRef={inputRef} />
    </section>
  );
}

/** Jhola's mark beside its messages: a tiny painted sign. */
function Mark() {
  return (
    <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sign pt-1">
      <span className="painted text-xl leading-none">J</span>
    </span>
  );
}

function AgentTurn({
  t,
  canUndo,
  onUndo,
  onSend,
  onConfirm,
  onDecline,
  onTrace,
  onStop,
  busy,
}: {
  t: ChatTurnView;
  canUndo: boolean;
  onUndo: () => void;
  onSend: (s: string) => void;
  onConfirm: () => void;
  onDecline: () => void;
  onTrace: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex gap-3">
      <Mark />
      <div className="min-w-0 flex-1 space-y-3">
        {t.brief?.summary && (
          <div className="w-fit max-w-full rounded-r-md border-l-4 border-turmeric bg-turmeric-soft px-3 py-2 text-sm text-turmeric-text">
            <p>
              <span className="font-semibold">I understood:</span> {t.brief.summary}
            </p>
            {t.brief.assumptions.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[13px]">
                {t.brief.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {t.state === "working" && (
          <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-soft">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-rani motion-safe:animate-pulse" aria-hidden />
            <span>{t.progress}</span>
            {t.planned ? <span className="num">{t.planned} items planned</span> : null}
            <button type="button" onClick={onStop} className={button("quiet", "ml-1 text-sm")}>
              Stop
            </button>
          </p>
        )}

        {t.reply && <p className={`text-[1.0625rem] leading-relaxed ${t.state === "error" || t.state === "gave_up" ? "text-chilli" : "text-ink"}`}>{t.reply}</p>}

        {t.state === "confirm" && t.pending && (
          <div className={`${PANEL} px-4 py-3`}>
            <DiffList d={t.pending.diff} />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onConfirm} className={button("primary")}>
                Yes, make the change
              </button>
              <button type="button" onClick={onDecline} className={button("secondary")}>
                Keep my cart
              </button>
            </div>
          </div>
        )}

        {t.question && t.state === "done" && (
          <div role="group" className="flex flex-wrap gap-2" aria-label={t.question.question}>
            <span className="sr-only">{t.question.question}</span>
            {t.question.options.map((o) => (
              <button key={o} type="button" disabled={busy} onClick={() => onSend(o)} className={chip("pref", "hover:bg-sign-soft")}>
                {o}
              </button>
            ))}
          </div>
        )}

        {t.state === "done" && t.diff && hasChanges(t.diff) && t.meta && t.diff.total_before > 0 && (
          <div className="rounded-md border border-line bg-paper px-4 py-3">
            <DiffList d={t.diff} />
            {t.undone ? (
              <p className="mt-2 text-sm text-ink-soft">Undone.</p>
            ) : (
              canUndo && (
                <button type="button" onClick={onUndo} className={button("secondary", "mt-2.5 px-3 py-1 text-sm")}>
                  Undo
                </button>
              )
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" onClick={onTrace} className={button("quiet-soft", "num flex flex-wrap gap-x-2 text-xs")}>
              <span>{t.meta.cached ? "From the cache" : `${t.meta.model_calls === 0 ? "Answered" : "Built"} in ${secs(t.meta.latency_ms)}`}</span>
              <span>{t.meta.model_calls + t.meta.tool_calls} steps</span>
              <span>{rupeesExact(t.meta.cost_inr)} to run</span>
            </button>
            <Feedback key={t.meta.request_id} requestId={t.meta.request_id} label="Helpful?" />
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
          <li key={`${p.sign}${p.text}`} className={`flex gap-2 ${p.sign === "+" ? "text-sign" : p.sign === "−" ? "text-chilli" : "text-ink"}`}>
            <span className="num w-3 shrink-0 text-center font-bold" aria-hidden>
              {p.sign === "~" ? "↻" : p.sign}
            </span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
      <p className="num mt-2 border-t border-line pt-1.5 font-semibold text-ink">
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
    <div className="sticky bottom-0 -mx-4 mt-6 bg-wall/95 px-4 pb-4 pt-3 backdrop-blur sm:mx-0 sm:px-0">
      {chips.length > 0 && (
        <div role="group" className="mb-2.5 flex flex-wrap gap-2" aria-label="Suggestions">
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => onSend(c)} className={chip("suggest")}>
              {c}
            </button>
          ))}
        </div>
      )}
      <form
        className={`${PANEL} flex items-end gap-2 p-1.5 focus-within:border-rani`}
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
        <button type="submit" disabled={busy || !text.trim()} className={button("primary", "shrink-0")}>
          Send
        </button>
      </form>
    </div>
  );
}
