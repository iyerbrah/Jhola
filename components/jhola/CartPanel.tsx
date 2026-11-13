"use client";

import { useState } from "react";
import type { Action } from "@/lib/chat/session";
import { DIET_LABELS } from "@/lib/requirements";
import { QUALITIES, type Brief, type Cart, type Check, type Line, type Need } from "@/lib/cart/types";
import report from "@/data/catalog/report.json";
import { rupees } from "../format";
import { button, chip, PANEL, PriceTag } from "../ui";
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
    <article aria-label="Your cart" className={bare ? "-mx-5 -mt-5 flex flex-col" : `${PANEL} flex flex-col overflow-hidden`}>
      {/* The cart's own little sign: its name and the tag with what you'd pay. */}
      {bare ? (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-wall px-5 py-3">
          <p className="text-ink-soft">
            {counted.length} {counted.length === 1 ? "item" : "items"}
          </p>
          <PriceTag amount={cart.total} label="Cart total" />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 bg-sign px-5 py-3.5 shadow-[0_4px_0_var(--color-turmeric)]">
          <h2 className="font-sign text-2xl leading-tight text-on-sign">Your cart</h2>
          <span aria-live="polite">
            <PriceTag amount={cart.total} label="Cart total" />
          </span>
        </div>
      )}

      <header className={`border-b border-line px-5 pb-4 ${bare ? "pt-3" : "pt-5"}`}>
        <Preferences brief={brief} disabled={busy} onTap={onTap} />
        {checks.length > 0 && <Checklist checks={checks} />}
      </header>

      <div className="flex-1 px-5">
        {empty && !busy && <p className="py-10 text-center text-ink-soft">Tell Jhola what you need, and the cart fills here.</p>}
        {listing && (
          <section aria-label="Shopping list" className="my-4 rounded-r-md border-l-4 border-turmeric bg-turmeric-soft px-4 py-3">
            <h3 className="wide text-sm font-semibold text-turmeric-text">Writing the list</h3>
            <ul className="mt-1.5 divide-y divide-turmeric/40 font-medium text-ink">
              {listing.map((line, i) => (
                <li key={`${i}:${line}`} className="flex h-9 items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{line}</span>
                  <span className="skeleton h-3.5 w-14 shrink-0 bg-turmeric/50!" aria-hidden />
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
            {groups.length > 1 && <h3 className="wide mt-5 border-b-2 border-sign pb-1 text-sm font-semibold text-sign">{cap(g)}</h3>}
            <ul className="divide-y divide-line">
              {counted
                .filter((l) => l.group === g)
                .map((l) => (
                  <LineRow
                    key={`${l.need_id}:${l.product.id}`}
                    line={l}
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
            {placeholders.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 py-3.5">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{n.label}</span>
                  {n.why && <span className="mt-1 inline-block rounded-full bg-sign-soft px-2 py-0.5 text-xs font-semibold text-sign">{n.why}</span>}
                </span>
                <span className="skeleton h-4 w-12" aria-hidden />
              </li>
            ))}
          </ul>
        )}

        {(cart.unmet.length > 0 || cart.dropped.length > 0 || cart.skipped.length > 0) && (
          <section aria-label="Not in the cart" className="my-4 space-y-1 rounded-md border border-dashed border-ink-soft px-4 py-3 text-sm">
            <h3 className="wide font-semibold text-ink">Not in the cart</h3>
            {cart.unmet.map((u) => (
              <p key={u.need_id} className="text-turmeric-text">
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
            <section key={s.title} className="mb-3 mt-3 rounded-md bg-wall px-4 py-3" aria-label={s.title}>
              <h3 className="wide font-semibold text-ink">{s.title}</h3>
              <p className="text-sm text-ink-soft">{s.hint}</p>
              <ul className="mt-2 space-y-0.5">
                {s.lines.map((l) => (
                  <li key={l.need_id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 hover:bg-paper">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={busy}
                        aria-label={`Add ${l.product.name}, ${l.product.brand} ${l.product.pack_label}`}
                        onChange={() => onTap({ type: "tick", need_id: l.need_id, ticked: true }, `Added ${l.product.name}`)}
                        className="h-5 w-5 shrink-0 accent-sign"
                      />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="font-semibold text-ink">{l.product.name}</span>
                        <span className="text-ink-soft">
                          , {l.product.brand} {l.product.pack_label}
                        </span>
                        {l.why && <span className="block text-sign">{l.why}</span>}
                      </span>
                      <span className="num shrink-0 text-sm text-ink-soft">{rupees(l.line_total)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>

      <footer className="border-t-2 border-sign px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink-soft">
              Total for {counted.length} {counted.length === 1 ? "item" : "items"}
            </p>
            <p className="num font-sign text-[2rem] leading-none text-ink">{rupees(cart.total)}</p>
            <p className="mt-1 text-xs text-ink-soft">Approximate prices, {report.prices_as_of}</p>
          </div>
          <button type="button" onClick={onCheckout} disabled={busy || !counted.length} className={button("buy")}>
            Review &amp; checkout
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <button type="button" onClick={onCopy} disabled={!counted.length} className={button("quiet")}>
            Copy list
          </button>
          <button type="button" onClick={onShare} disabled={busy || !counted.length} className={button("quiet")}>
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
  const x = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Remove ${label}`}
      className="-mr-1 flex h-5 w-5 items-center justify-center rounded-full text-ink-soft hover:bg-chilli-soft hover:text-chilli disabled:opacity-40"
    >
      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden>
        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </button>
  );
  const step = "flex h-6 w-6 items-center justify-center rounded-full text-base leading-none hover:bg-sign-soft disabled:opacity-30";
  const hasAny = brief.people != null || brief.budget_inr != null || brief.diet || brief.rules.length > 0 || (brief.avoid ?? []).length > 0 || brief.summary;
  if (!hasAny) return null;
  return (
    <div role="group" aria-label="Your preferences">
      <p className="wide text-sm font-semibold text-ink">Your preferences</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {brief.people != null && (
          <span className={chip("pref", "px-1.5")}>
            <button
              type="button"
              disabled={disabled || brief.people <= 1}
              onClick={() => onTap({ type: "brief", people: brief.people! - 1 }, `${brief.people! - 1} ${brief.people! - 1 === 1 ? "person" : "people"}`)}
              aria-label="One person fewer"
              className={step}
            >
              −
            </button>
            <span className="num">
              {brief.people} {brief.people === 1 ? "person" : "people"}
            </span>
            <button
              type="button"
              disabled={disabled || brief.people >= 50}
              onClick={() => onTap({ type: "brief", people: brief.people! + 1 }, `${brief.people! + 1} people`)}
              aria-label="One person more"
              className={step}
            >
              +
            </button>
          </span>
        )}
        {brief.budget_inr != null ? (
          <span className={chip("pref")}>
            <span className="num">Budget {rupees(brief.budget_inr)}</span>
            {x("the budget", () => onTap({ type: "brief", budget_inr: 0 }, "No budget"))}
          </span>
        ) : editingBudget ? (
          <form
            className={chip("pref", "focus-within:border-rani")}
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
            <button type="submit" className="font-semibold text-sign">
              Set
            </button>
          </form>
        ) : (
          <button type="button" disabled={disabled} onClick={() => setEditingBudget(true)} className={chip("add")}>
            + Budget
          </button>
        )}
        {brief.diet && (
          <span className={chip("diet")}>
            {cap(DIET_LABELS[brief.diet])}
            {x(DIET_LABELS[brief.diet], () => onTap({ type: "brief", diet: "any" }, "No diet rule"))}
          </span>
        )}
        {brief.rules.map((r) => (
          <span key={r.label} className={chip("pref")}>
            {r.label}
            {x(r.label, () => onTap({ type: "remove_rule", label: r.label }, `Removed "${r.label}"`))}
          </span>
        ))}
        {(brief.avoid ?? []).map((c) => (
          <span key={`avoid-${c}`} className={chip("diet")}>
            No {c}
            {x(`No ${c}`, () => onTap({ type: "remove_avoid", value: c }, `${cap(c)} is fine now`))}
          </span>
        ))}
        {[...(brief.prefer?.labels ?? []), ...(brief.prefer?.brands ?? [])].map((v) => {
          const label = cap(v.replace(/_/g, " "));
          return (
            <span key={`prefer-${v}`} className={chip("pref")}>
              Prefer {label}
              {x(`Prefer ${label}`, () => onTap({ type: "remove_prefer", value: v }, `No preference for ${label}`))}
            </span>
          );
        })}
      </div>
      <div className="mt-2.5 inline-flex rounded-full border border-line bg-wall p-0.5 text-sm" role="radiogroup" aria-label="Quality">
        {QUALITIES.map((q) => (
          <button
            key={q}
            type="button"
            role="radio"
            aria-checked={brief.quality === q}
            disabled={disabled}
            onClick={() => brief.quality !== q && onTap({ type: "brief", quality: q }, `${cap(q)} picks`)}
            className={`rounded-full px-3.5 py-1 transition-colors ${brief.quality === q ? "bg-sign font-semibold text-on-sign" : "text-ink-soft hover:text-ink"}`}
          >
            {cap(q)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What code checked, not the model: passes as one quiet line, anything else spelt out. */
function Checklist({ checks }: { checks: Check[] }) {
  const pass = checks.filter((c) => c.status === "pass");
  const other = checks.filter((c) => c.status !== "pass");
  return (
    <section className="mt-4 rounded-md bg-sign-soft px-3 py-2.5 text-sm" aria-label="Checks">
      <h3 className="wide font-semibold text-sign">Checked by code, not the model</h3>
      <ul className="mt-1 flex flex-wrap gap-x-3.5 gap-y-0.5 text-sign">
        {pass.map((c) => (
          <li key={c.id}>
            <span aria-hidden>✓ </span>
            {c.label}
          </li>
        ))}
      </ul>
      {other.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-t border-sign/20 pt-1.5">
          {other.map((c) => (
            <li key={c.id} className={c.status === "fail" ? "font-semibold text-chilli" : "text-turmeric-text"}>
              <span aria-hidden>{c.status === "fail" ? "✗ " : "⚠ "}</span>
              {c.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
