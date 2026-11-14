"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { blockedBy } from "@/lib/cart/solve";
import { isSameKind } from "@/lib/cart/kind";
import type { Brief, Line } from "@/lib/cart/types";
import { packLabel, type Product } from "@/lib/schema";
import { count, rupees, rupeesExact, secs, usd } from "../format";
import { Sheet } from "../Sheet";
import { StarRating } from "./StarRating";
import { button, FIELD_ERROR, INPUT, LABEL } from "../ui";
import type { ChatTurnView, Placed } from "./useJhola";

/** Swap a line for another product of its kind that fits the diet and every rule. Picking one pins it. */
export function PickSheet({ line, brief, products, onPick, onClose }: { line: Line | null; brief: Brief; products: Product[] | null; onPick: (p: Product) => void; onClose: () => void }) {
  // Same kind, unit and form (fresh cream never becomes a cream biscuit), fitting the diet and every rule.
  const current = line && products ? products.find((p) => p.id === line.product.id) : undefined;
  const options =
    line && products
      ? products
          .filter((p) => p.in_stock && p.id !== line.product.id && (current ? isSameKind(current, p) : p.sub_category === line.product.sub_category) && !blockedBy(p, brief))
          .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))
      : null;
  return (
    <Sheet open={!!line} onClose={onClose} title={line ? `Swap ${line.product.name}` : "Swap"}>
      {line && (
        <>
          <p className="text-ink-soft">
            Now: {line.product.brand}, {line.product.pack_label} × {line.packs} at <span className="num">{rupees(line.line_total)}</span>. Everything below fits your preferences.
          </p>
          {options === null && (
            <p role="status" className="mt-3 text-ink-soft">
              Loading other options…
            </p>
          )}
          {options?.length === 0 && <p className="mt-3 text-ink-soft">Nothing else of this kind fits and is in stock.</p>}
          <ul className="mt-3 divide-y divide-line">
            {(options ?? []).map((p) => {
              const diff = p.price - line.product.price;
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onPick(p)} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-3 text-left hover:bg-sign-soft">
                    <span className="min-w-0">
                      <span className="block font-semibold">{p.name}</span>
                      <span className="block text-sm text-ink-soft">
                        {p.brand}, {packLabel(p)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block font-semibold">{rupees(p.price)}</span>
                      <span className={`num block text-sm ${diff < 0 ? "font-semibold text-sign" : "text-ink-soft"}`}>
                        {diff === 0 ? "same price" : diff < 0 ? `${rupees(-diff)} less a pack` : `${rupees(diff)} more a pack`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}

/**
 * The thank-you popup after "Looks good, I'm done": the order (already logged), then stars, a comment and a
 * first name, shown on the public History page. A star counts the moment it's tapped; sending adds the rest.
 * Closing it any way starts a new cart.
 */
export function OrderedSheet({ placed, onDone }: { placed: Placed | null; onDone: () => void }) {
  return (
    <Sheet open={!!placed} onClose={onDone} title="Your jhola is packed">
      {placed && <ThankYou key={placed.id} placed={placed} onDone={onDone} />}
    </Sheet>
  );
}

type Saving = "idle" | "saving" | "saved" | "failed";

/** The thank-you popup: one line about the order, then the ask, first. */
function ThankYou({ placed, onDone }: { placed: Placed; onDone: () => void }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  // The stars alone save on tap ("rated"); the form's send saves everything ("sent"). A later save replaces an earlier one.
  const [rated, setRated] = useState<Saving>("idle");
  const [sent, setSent] = useState<Saving>("idle");
  const [missing, setMissing] = useState(false);
  const [closing, setClosing] = useState(false);

  // Saves go one after another, so a quick second tap (or a send) always lands last and wins.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function save(body: { stars: number; comment?: string; name?: string }): Promise<boolean> {
    const next = queue.current.then(() => post(body));
    queue.current = next;
    return next;
  }
  async function post(body: { stars: number; comment?: string; name?: string }): Promise<boolean> {
    try {
      const res = await fetch("/api/order/rating", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: placed.id, ...body }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function rate(n: number) {
    setStars(n);
    setMissing(false);
    setRated("saving");
    setRated((await save({ stars: n })) ? "saved" : "failed");
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!stars) return setMissing(true);
    if (sent === "saving") return;
    setSent("saving");
    setSent((await save({ stars, comment: comment.trim() || undefined, name: name.trim() || undefined })) ? "saved" : "failed");
  }

  if (sent === "saved" || closing) {
    return (
      <div>
        <p role="status" className="rounded-md bg-sign-soft px-4 py-3 text-lg font-semibold text-sign">
          {sent === "saved" ? "Thank you! That helps Jhola get better." : rated === "saved" ? "Thanks for the stars." : "No problem."}
        </p>
        <button type="button" autoFocus onClick={onDone} className={button("primary", "mt-6 w-full py-3")}>
          Start a new cart
        </button>
        {(sent === "saved" || rated === "saved") && (
          <p className="mt-4 text-center">
            <Link href="/history" className={button("quiet")}>
              See it on History
            </Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="num text-ink-soft">
        Order <span className="font-semibold text-ink">{placed.number}</span>: {placed.items} {placed.items === 1 ? "item" : "items"},{" "}
        <span className="font-semibold text-ink">{rupees(placed.total)}</span>. It&apos;s a demo, so nothing is bought or charged.
      </p>

      <form onSubmit={send} className="mt-5 space-y-5 border-t-2 border-sign pt-5">
        <div>
          <StarRating value={stars} onChange={(n) => void rate(n)} legend="How did Jhola do?" />
          <p role="status" className="mt-1.5 text-sm font-semibold text-sign empty:hidden">
            {rated === "saved" ? "Saved. Tell us a bit more?" : ""}
          </p>
          {(rated === "failed" || missing) && (
            <p role="alert" className={`mt-1.5 ${FIELD_ERROR}`}>
              {missing ? "Pick 1 to 5 stars first." : "Couldn't save that. Tap a star again."}
            </p>
          )}
        </div>
        <label className="block">
          <span className={LABEL}>What should Jhola do better?</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="e.g. right amounts, but it missed the bread"
            className={`${INPUT} placeholder:text-ink-soft`}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Your first name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="given-name" className={INPUT} />
          <span className="mt-1.5 block text-sm text-ink-soft">Shown with your stars and comment on the public History page. Phone numbers, emails and links are removed.</span>
        </label>
        {sent === "failed" && (
          <p role="alert" className={FIELD_ERROR}>
            Couldn&apos;t send that. Try again.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={sent === "saving"} className={button("primary", "flex-1 py-3")}>
            {sent === "saving" ? "Sending…" : "Send feedback"}
          </button>
          <button type="button" onClick={() => setClosing(true)} className={button("quiet")}>
            Not now
          </button>
        </div>
      </form>
    </div>
  );
}

/** Every model and tool call in one turn, with its time and tokens. */
export function TraceSheet({ turn, onClose }: { turn: ChatTurnView | null; onClose: () => void }) {
  const m = turn?.meta;
  return (
    <Sheet open={!!turn} onClose={onClose} title="What Jhola did">
      {m && (
        <>
          <p className="text-ink-soft">
            {m.cached
              ? "From the cache: no model call."
              : `${m.model_calls} model call${m.model_calls === 1 ? "" : "s"} and ${m.tool_calls} tool call${m.tool_calls === 1 ? "" : "s"} in ${secs(m.latency_ms)}, for ${rupeesExact(m.cost_inr)} (${usd(m.cost_usd)}).`}
            {m.finished_by === "code" ? " Code checked the cart and wrote the reply, so no extra model call was needed to finish." : ""}
          </p>
          <ol className="mt-3 space-y-1.5 text-sm">
            {m.steps.map((s, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 rounded-md bg-wall px-3 py-1.5">
                <span className="min-w-0">
                  <span className={`mr-2 inline-block w-12 text-xs font-bold ${s.kind === "model" ? "text-rani" : "text-sign"}`}>{s.kind === "model" ? "Model" : "Tool"}</span>
                  <span className={s.ok ? "text-ink" : "text-chilli"}>{s.name}</span>
                  {!s.ok && s.error && <span className="block text-xs text-chilli">{s.error}</span>}
                </span>
                <span className="num shrink-0 text-ink-soft">
                  {s.ms} ms
                  {s.kind === "model" && s.input_tokens ? `, ${count(s.input_tokens)} in (${count(s.cached_tokens ?? 0)} cached), ${count(s.output_tokens)} out` : ""}
                </span>
              </li>
            ))}
          </ol>
          {turn?.meta?.request_id && <p className="mt-3 text-xs text-ink-soft">Request {turn.meta.request_id}</p>}
        </>
      )}
    </Sheet>
  );
}
