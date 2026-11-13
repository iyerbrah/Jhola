"use client";

import { useState } from "react";
import { neededLabel } from "@/lib/chat/client";
import type { Line } from "@/lib/cart/types";
import { rupees } from "../format";
import { button } from "../ui";

type Props = {
  line: Line;
  people: number | null;
  flash: boolean;
  disabled: boolean;
  onQty: (packs: number) => void;
  onSwap: () => void;
  onRemove: () => void;
};

/** One cart line: what it is, why it's there, how it was picked, and the controls to change it. */
export function LineRow({ line: l, people, flash, disabled, onQty, onSwap, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const sub = l.substitution;
  return (
    <li className={`py-3.5 ${flash ? "flash" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug text-ink">{l.product.name}</p>
          <p className="text-sm text-ink-soft">
            {l.product.brand}, {l.product.pack_label} <span className="num">at {rupees(l.product.price)}</span>
          </p>
          {(l.why || l.needed || l.pinned) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              {l.why && <span className="rounded-full bg-sign-soft px-2 py-0.5 font-semibold text-sign">{l.why}</span>}
              {l.needed && <span className="rounded-full border border-line px-2 py-0.5 text-ink-soft">{neededLabel(l.needed.amount, l.needed.unit, l.per_person ? people : null)}</span>}
              {l.pinned && <span className="rounded-full bg-rani-soft px-2 py-0.5 font-semibold text-rani">Your pick</span>}
            </p>
          )}
        </div>
        <p className="num shrink-0 pt-0.5 text-[1.0625rem] font-bold text-ink">{rupees(l.line_total)}</p>
      </div>

      {sub && (
        <p className="mt-2.5 rounded-r-md border-l-4 border-turmeric bg-turmeric-soft px-3 py-1.5 text-sm text-turmeric-text">
          <strong>
            {sub.wanted.brand} {sub.wanted.name}
          </strong>{" "}
          is out of stock, so this is the closest match
          {sub.wanted.pack_label === l.product.pack_label ? ", same size" : ""}, {sub.delta_inr === 0 ? "same price" : `${rupees(Math.abs(sub.delta_inr))} ${sub.delta_inr > 0 ? "more" : "less"}`}.
        </p>
      )}
      {l.flagged && (
        <p className="mt-2.5 rounded-r-md border-l-4 border-chilli bg-chilli-soft px-3 py-1.5 text-sm text-chilli">
          This listing contains hidden instructions aimed at shopping assistants. Jhola ignored them and picked it only on price and fit.
        </p>
      )}
      {l.warnings.map((w) => (
        <p key={w} className="mt-2 text-sm text-turmeric-text">
          ⚠ {w}
        </p>
      ))}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex items-center rounded-md border border-line bg-paper" role="group" aria-label={`Packs of ${l.product.name}`}>
          <button
            type="button"
            onClick={() => onQty(l.packs - 1)}
            disabled={disabled || l.packs <= 1}
            aria-label={`One pack fewer of ${l.product.name}`}
            className="h-8 w-8 rounded-l-md text-lg text-ink hover:bg-sign-soft disabled:opacity-30"
          >
            −
          </button>
          <span className="num w-7 text-center font-semibold" aria-live="polite">
            {l.packs}
          </span>
          <button
            type="button"
            onClick={() => onQty(l.packs + 1)}
            disabled={disabled || l.packs >= 10}
            aria-label={`One more pack of ${l.product.name}`}
            className="h-8 w-8 rounded-r-md text-lg text-ink hover:bg-sign-soft disabled:opacity-30"
          >
            +
          </button>
        </div>
        <button type="button" onClick={onSwap} disabled={disabled} className={button("quiet", "text-sm")}>
          Swap
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-sm text-ink-soft underline decoration-transparent decoration-2 underline-offset-4 hover:text-chilli hover:decoration-chilli disabled:opacity-40"
        >
          Remove
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={button("quiet-soft", "ml-auto text-sm")}>
          How I picked this
        </button>
      </div>

      {open && (
        <div className="mt-2.5 rounded-md bg-wall px-3 py-2.5 text-sm">
          <p>
            <span className="font-semibold">{l.picked.rule}.</span>{" "}
            <span className="text-ink-soft">
              Looked at {l.picked.kind.replace(/_/g, " ")}
              {l.needed ? `, for ${neededLabel(l.needed.amount, l.needed.unit, l.per_person ? people : null)}` : ""}.
            </span>
          </p>
          <table className="mt-2 w-full text-left">
            <caption className="sr-only">Options compared</caption>
            <thead className="text-xs text-ink-soft">
              <tr className="border-b border-line">
                <th className="py-1 font-semibold">Option</th>
                <th className="py-1 text-right font-semibold">Per unit</th>
                <th className="py-1 text-right font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody>
              {l.picked.compared.map((o) => (
                <tr key={o.product_id} className={o.product_id === l.product.id ? "font-semibold text-ink" : "text-ink-soft"}>
                  <td className="py-1 pr-2">
                    {o.product_id === l.product.id ? <span className="text-sign">✓ </span> : ""}
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
