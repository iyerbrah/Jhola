"use client";

import { useState } from "react";
import type { Action } from "@/lib/chat/session";
import { DIET_LABELS } from "@/lib/requirements";
import { QUALITIES, type Brief, type Cart, type Check, type Line, type Need } from "@/lib/cart/types";
import { rupees } from "../format";
import { LineRow } from "./LineRow";

type Props = {
  brief: Brief;
  needs: Need[];
  /** The shopping list while a turn is writing it, before its needs arrive: shown on ruled paper. */
  plan: string[] | null;
  cart: Cart;
  checks: Check[];
  /** A turn is running: controls wait, and planned needs show as placeholders until their lines arrive. */
  busy: boolean;
  planning: boolean;
  flash: string[];
  onTap: (a: Action, text: string) => void;
  onSwap: (line: Line) => void;
  onCheckout: () => void;
  onCopy: () => void;
  onShare: () => void;
  shareNote: string | null;
  /** Inside a sheet that has its own title: no card frame, handle or heading. */
  bare?: boolean;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function CartPanel({ brief, needs, plan, cart, checks, busy, planning, flash, onTap, onSwap, onCheckout, onCopy, onShare, shareNote, bare = false }: Props) {
  const counted = cart.lines.filter((l) => l.counted);
  const pantry = cart.lines.filter((l) => !l.counted && l.role === "pantry");
  const suggestions = cart.lines.filter((l) => !l.counted && l.role !== "pantry");
  const groups = [...new Set(counted.map((l) => l.group))];
  const placeholders = planning ? needs.filter((n) => n.ticked && !cart.lines.some((l) => l.need_id === n.id)) : [];
  const listing = plan && plan.length > 0 && !planning ? plan : null;
  const empty = !counted.length && !placeholders.length && !listing;

  return (
    <article
      aria-label="Your cart"
      className={bare ? "-mx-5 flex flex-col" : "relative mt-6 flex flex-col rounded-3xl border-2 border-t-[6px] border-ink bg-paper shadow-lift"}
      style={bare ? undefined : ({ "--tier": "var(--color-marigold)", borderTopColor: "var(--color-marigold)" } as React.CSSProperties)}
    >
      {!bare && <span className="jhola-handle" aria-hidden />}

      <header className={`border-b border-line px-5 pb-4 ${bare ? "pt-0" : "pt-6"}`}>
        {!bare && (
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl leading-tight text-ink">Your cart</h2>
            <p className="num font-display text-2xl text-leaf" aria-live="polite">
              {rupees(cart.total)}
            </p>
          </div>
        )}
        <Preferences brief={brief} disabled={busy} onTap={onTap} />
        {checks.length > 0 && <Checklist checks={checks} />}
      </header>

      <div className="flex-1 px-5">
        {empty && !busy && <p className="py-8 text-center text-ink-soft">Tell Jhola what you need, and the cart builds here.</p>}
        {listing && (
          <section aria-label="Shopping list" className="my-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">Shopping list</h3>
            <ul className="ruled mt-1 font-medium leading-8 text-ink">
              {listing.map((line, i) => (
                <li key={`${i}:${line}`} className="rise flex h-8 items-center justify-between gap-3" style={{ "--i": i } as React.CSSProperties}>
                  <span className="min-w-0 truncate">{line}</span>
                  <span className="skeleton h-3.5 w-14 shrink-0" aria-hidden />
                </li>
              ))}
            </ul>
            <p className="sr-only" role="status">
              Jhola wrote a list of {listing.length} items and is finding the products.
            </p>
          </section>
        )}
        {groups.map((g) => (
          <section key={g} aria-label={groups.length > 1 ? cap(g) : undefined}>
            {groups.length > 1 && <h3 className="mt-4 text-xs font-bold uppercase tracking-wider text-ink-soft">{g}</h3>}
            <ul className="divide-y divide-line">
              {counted
                .filter((l) => l.group === g)
                .map((l) => (
                  <LineRow
                    key={`${l.need_id}:${l.product.id}`}
                    line={l}
                    i={counted.indexOf(l)}
                    people={brief.people}
                    flash={flash.includes(l.product.id)}
                    disabled={busy}
                    onQty={(packs) => onTap({ type: "pin", need_id: l.need_id, product_id: l.product.id, qty: packs }, `${l.product.name}: ${packs} pack${packs === 1 ? "" : "s"}`)}
                    onSwap={() => onSwap(l)}
                    onRemove={() => onTap({ type: "remove_need", need_id: l.need_id }, `Removed ${l.product.name}`)}
                  />
                ))}
            </ul>
          </section>
        ))}
        {placeholders.length > 0 && (
          <ul aria-label="Being planned" className="divide-y divide-line">
            {placeholders.map((n, i) => (
              <li key={n.id} className="rise flex items-center justify-between gap-3 py-3" style={{ "--i": i } as React.CSSProperties}>
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{n.label}</span>
                  {n.why && <span className="mt-1 inline-block rounded-full bg-leaf-soft px-2 py-0.5 text-xs font-semibold text-leaf">{n.why}</span>}
                </span>
                <span className="skeleton h-4 w-12" aria-hidden />
              </li>
            ))}
          </ul>
        )}

        {(cart.unmet.length > 0 || cart.dropped.length > 0 || cart.skipped.length > 0) && (
          <section aria-label="Not in the cart" className="my-3 space-y-1 rounded-2xl border border-line px-4 py-3 text-sm">
            {cart.unmet.map((u) => (
              <p key={u.need_id} className="text-marigold-text">
                ⚠ No {u.label.toLowerCase()}: {u.detail}.
              </p>
            ))}
            {cart.dropped.map((d) => (
              <p key={d.need_id} className="text-ink-soft">
                Left out {d.label.toLowerCase()} to fit the budget.
              </p>
            ))}
            {cart.skipped.map((s) => (
              <p key={s.need_id} className="text-ink-soft">
                {s.reason === "rule" ? `Left out ${s.label.toLowerCase()} (${s.rule}).` : `Skipped ${s.label.toLowerCase()}: you have it.`}
              </p>
            ))}
          </section>
        )}

        {[
          { title: "You may already have", hint: "Tick anything you need to add it.", lines: pantry },
          { title: "You might also like", hint: "Suggestions, not counted until you tick them.", lines: suggestions },
        ]
          .filter((s) => s.lines.length)
          .map((s) => (
            <section key={s.title} className="mb-2 mt-2 rounded-2xl bg-chalk px-4 py-3" aria-label={s.title}>
              <h3 className="font-semibold text-ink">{s.title}</h3>
              <p className="text-sm text-ink-soft">{s.hint}</p>
              <ul className="mt-2 space-y-1">
                {s.lines.map((l) => (
                  <li key={l.need_id}>
                    <label className="flex cursor-pointer items-center gap-3 py-1">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={busy}
                        aria-label={`Add ${l.product.name}, ${l.product.brand} ${l.product.pack_label}`}
                        onChange={() => onTap({ type: "tick", need_id: l.need_id, ticked: true }, `Added ${l.product.name}`)}
                        className="h-5 w-5 shrink-0 accent-ink"
                      />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="font-medium text-ink">{l.product.name}</span>
                        <span className="text-ink-soft">, {l.product.brand} {l.product.pack_label}</span>
                        {l.why && <span className="text-leaf"> · {l.why}</span>}
                      </span>
                      <span className="num shrink-0 text-sm text-ink-soft">{rupees(l.line_total)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>

      <footer className="border-t-2 border-ink px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink-soft">
              Total for {counted.length} {counted.length === 1 ? "item" : "items"}
            </p>
            <p className="num font-display text-3xl leading-none text-ink">{rupees(cart.total)}</p>
          </div>
          <button type="button" onClick={onCheckout} disabled={busy || !counted.length} className="rounded-xl bg-marigold px-4 py-3 font-bold text-ink hover:bg-marigold-deep disabled:cursor-not-allowed disabled:opacity-40">
            Review &amp; checkout
          </button>
        </div>
        <div className="mt-3 flex items-center gap-4 text-sm">
          <button type="button" onClick={onCopy} disabled={!counted.length} className="font-semibold text-ink underline decoration-mist decoration-2 underline-offset-4 hover:decoration-ink disabled:opacity-40">
            Copy list
          </button>
          <button type="button" onClick={onShare} disabled={busy || !counted.length} className="font-semibold text-ink underline decoration-mist decoration-2 underline-offset-4 hover:decoration-ink disabled:opacity-40">
            Share link
          </button>
          {shareNote && (
            <span role="status" className="text-ink-soft">
              {shareNote}
            </span>
          )}
        </div>
      </footer>
    </article>
  );
}

/** The pinned preferences: people, budget, diet, quality and every standing rule, each one tap to change. */
function Preferences({ brief, disabled, onTap }: { brief: Brief; disabled: boolean; onTap: (a: Action, text: string) => void }) {
  const [editingBudget, setEditingBudget] = useState(false);
  const [budget, setBudget] = useState("");
  const chip = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm";
  const x = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={`Remove ${label}`} className="-mr-1 rounded-full px-1 text-ink-soft hover:text-chilli disabled:opacity-40">
      ✕
    </button>
  );
  const hasAny = brief.people != null || brief.budget_inr != null || brief.diet || brief.rules.length > 0 || brief.summary;
  if (!hasAny) return null;
  return (
    <div className="mt-3" role="group" aria-label="Your preferences">
      <p className="text-xs font-bold uppercase tracking-wider text-ink-soft">Your preferences</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {brief.people != null && (
          <span className={`${chip} border-ink bg-paper font-semibold`}>
            <button type="button" disabled={disabled || brief.people <= 1} onClick={() => onTap({ type: "brief", people: brief.people! - 1 }, `${brief.people! - 1} ${brief.people! - 1 === 1 ? "person" : "people"}`)} aria-label="One person fewer" className="px-1 disabled:opacity-30">
              −
            </button>
            <span className="num">
              {brief.people} {brief.people === 1 ? "person" : "people"}
            </span>
            <button type="button" disabled={disabled || brief.people >= 50} onClick={() => onTap({ type: "brief", people: brief.people! + 1 }, `${brief.people! + 1} people`)} aria-label="One person more" className="px-1 disabled:opacity-30">
              +
            </button>
          </span>
        )}
        {brief.budget_inr != null ? (
          <span className={`${chip} border-ink bg-paper font-semibold`}>
            <span className="num">Budget {rupees(brief.budget_inr)}</span>
            {x("the budget", () => onTap({ type: "brief", budget_inr: 0 }, "No budget"))}
          </span>
        ) : editingBudget ? (
          <form
            className={`${chip} border-ink bg-paper`}
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.round(Number(budget));
              if (n > 0) onTap({ type: "brief", budget_inr: n }, `Budget ₹${n}`);
              setEditingBudget(false);
              setBudget("");
            }}
          >
            <label htmlFor="budget" className="sr-only">
              Budget in rupees
            </label>
            ₹<input id="budget" autoFocus inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/\D/g, ""))} className="num w-16 bg-transparent focus:outline-none" />
            <button type="submit" className="font-semibold">
              Set
            </button>
          </form>
        ) : (
          <button type="button" disabled={disabled} onClick={() => setEditingBudget(true)} className={`${chip} border-dashed border-line text-ink-soft hover:border-ink hover:text-ink`}>
            + Budget
          </button>
        )}
        {brief.diet && (
          <span className={`${chip} border-leaf bg-leaf-soft font-semibold text-leaf`}>
            {cap(DIET_LABELS[brief.diet])}
            {x(DIET_LABELS[brief.diet], () => onTap({ type: "brief", diet: "any" }, "No diet rule"))}
          </span>
        )}
        {brief.rules.map((r) => (
          <span key={r.label} className={`${chip} border-ink bg-paper font-semibold`}>
            {r.label}
            {x(r.label, () => onTap({ type: "remove_rule", label: r.label }, `Removed "${r.label}"`))}
          </span>
        ))}
      </div>
      <div className="mt-2 inline-flex rounded-full border border-line p-0.5 text-sm" role="radiogroup" aria-label="Quality">
        {QUALITIES.map((q) => (
          <button
            key={q}
            type="button"
            role="radio"
            aria-checked={brief.quality === q}
            disabled={disabled}
            onClick={() => brief.quality !== q && onTap({ type: "brief", quality: q }, `${cap(q)} picks`)}
            className={`rounded-full px-3 py-0.5 ${brief.quality === q ? "bg-ink font-semibold text-on-ink" : "text-ink-soft hover:text-ink"}`}
          >
            {cap(q)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ✓ All in stock · ✓ Under ₹600 · ✓ No onions · ⚠ Basil only comes in 100 g, under "Checked by code". */
function Checklist({ checks }: { checks: Check[] }) {
  const pass = checks.filter((c) => c.status === "pass");
  const other = checks.filter((c) => c.status !== "pass");
  return (
    <section className="mt-3 text-sm" aria-label="Checks">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-leaf">
        <span aria-hidden>✓</span> Checked by code, not the model
      </h3>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-leaf">
        {pass.map((c) => (
          <span key={c.id}>✓ {c.label}</span>
        ))}
      </p>
      {other.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {other.map((c) => (
            <li key={c.id} className={c.status === "fail" ? "font-semibold text-chilli" : "text-marigold-text"}>
              {c.status === "fail" ? "✗" : "⚠"} {c.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
