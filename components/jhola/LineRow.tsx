"use client";

import { useState } from "react";
import { neededLabel } from "@/lib/chat/client";
import type { Line } from "@/lib/cart/types";
import { rupees } from "../format";

type Props = {
  line: Line;
  people: number | null;
  flash: boolean;
  /** Position in the cart, for the staggered reveal. */
  i: number;
  disabled: boolean;
  onQty: (packs: number) => void;
  onSwap: () => void;
  onRemove: () => void;
};

/** One cart line: what it is, why it's there, how it was picked, and the controls to change it. */
export function LineRow({ line: l, people, flash, i, disabled, onQty, onSwap, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const sub = l.substitution;
  return (
    <li className={`rise py-3 ${flash ? "flash" : ""}`} style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug text-ink">{l.product.name}</p>
          <p className="text-sm text-ink-soft">
            {l.product.brand}, {l.product.pack_label} <span className="num">at {rupees(l.product.price)}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {l.why && <span className="rounded-full bg-leaf-soft px-2 py-0.5 font-semibold text-leaf">{l.why}</span>}
            {l.needed && <span className="rounded-full bg-chalk px-2 py-0.5 text-ink-soft">{neededLabel(l.needed.amount, l.needed.unit, l.per_person ? people : null)}</span>}
            {l.pinned && <span className="rounded-full bg-mist px-2 py-0.5 font-semibold text-ink">Your pick</span>}
          </p>
        </div>
        <p className="num shrink-0 font-semibold text-ink">{rupees(l.line_total)}</p>
      </div>

      {sub && (
        <p className="mt-2 rounded-lg border-l-4 border-marigold bg-marigold-soft px-3 py-1.5 text-sm text-marigold-text">
          <strong>{sub.wanted.brand} {sub.wanted.name}</strong> is out of stock, so this is the closest match
          {sub.wanted.pack_label === l.product.pack_label ? ", same size" : ""}, {sub.delta_inr === 0 ? "same price" : `${rupees(Math.abs(sub.delta_inr))} ${sub.delta_inr > 0 ? "more" : "less"}`}.
        </p>
      )}
      {l.flagged && (
        <p className="mt-2 rounded-lg border-l-4 border-chilli bg-chilli-soft px-3 py-1.5 text-sm text-chilli">
          This listing contains hidden instructions aimed at shopping assistants. Jhola ignored them and picked it only on price and fit.
        </p>
      )}
      {l.warnings.map((w) => (
        <p key={w} className="mt-2 text-sm text-marigold-text">
          ⚠ {w}
        </p>
      ))}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center rounded-lg border border-line" role="group" aria-label={`Packs of ${l.product.name}`}>
          <button type="button" onClick={() => onQty(l.packs - 1)} disabled={disabled || l.packs <= 1} aria-label={`One pack fewer of ${l.product.name}`} className="h-8 w-8 text-lg text-ink disabled:opacity-30">
            −
          </button>
          <span className="num w-6 text-center font-semibold" aria-live="polite">
            {l.packs}
          </span>
          <button type="button" onClick={() => onQty(l.packs + 1)} disabled={disabled || l.packs >= 10} aria-label={`One more pack of ${l.product.name}`} className="h-8 w-8 text-lg text-ink disabled:opacity-30">
            +
          </button>
        </div>
        <button type="button" onClick={onSwap} disabled={disabled} className="text-sm font-semibold text-ink underline decoration-mist decoration-2 underline-offset-4 hover:decoration-ink disabled:opacity-40">
          Swap
        </button>
        <button type="button" onClick={onRemove} disabled={disabled} className="text-sm text-ink-soft underline decoration-transparent underline-offset-4 hover:text-chilli hover:decoration-chilli disabled:opacity-40">
          Remove
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ml-auto text-sm text-ink-soft underline decoration-line underline-offset-4 hover:text-ink">
          How I picked this
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-xl bg-chalk px-3 py-2.5 text-sm">
          <p>
            <span className="font-semibold">{l.picked.rule}.</span> <span className="text-ink-soft">Looked at {l.picked.kind.replace(/_/g, " ")}{l.needed ? `, for ${neededLabel(l.needed.amount, l.needed.unit, l.per_person ? people : null)}` : ""}.</span>
          </p>
          <table className="mt-2 w-full text-left">
            <caption className="sr-only">Options compared</caption>
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="py-1 font-medium">Option</th>
                <th className="py-1 text-right font-medium">Per unit</th>
                <th className="py-1 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {l.picked.compared.map((o) => (
                <tr key={o.product_id} className={o.product_id === l.product.id ? "font-semibold text-ink" : "text-ink-soft"}>
                  <td className="py-1 pr-2">
                    {o.product_id === l.product.id ? "✓ " : ""}
                    {o.brand} {o.name}, {o.pack_label}
                    {o.packs > 1 ? ` × ${o.packs}` : ""}
                  </td>
                  <td className="num whitespace-nowrap py-1 pl-2 text-right">{o.unit_price.replace(" per ", "/")}</td>
                  <td className="num whitespace-nowrap py-1 pl-2 text-right">{rupees(o.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}
