"use client";

import { MAX_QTY, type CartItem } from "@/lib/cartState";
import { rupees } from "./format";

type Props = {
  item: CartItem;
  canSwap: boolean;
  onQty: (qty: number) => void;
  onRemove: () => void;
  onSwap: () => void;
};

export function ItemRow({ item, canSwap, onQty, onRemove, onSwap }: Props) {
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug text-ink">{item.name}</p>
          <p className="text-sm text-ink-soft">
            {item.brand}, {item.pack_label} <span className="num">at {rupees(item.price)}</span>
          </p>
          {item.note && <p className="text-sm text-leaf">{item.note}</p>}
        </div>
        <p className="num shrink-0 font-semibold text-ink">{rupees(item.price * item.qty)}</p>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="flex items-center rounded-lg border border-line" role="group" aria-label={`Quantity of ${item.name}`}>
          <button
            type="button"
            onClick={() => onQty(item.qty - 1)}
            disabled={item.qty <= 1}
            aria-label={`One less ${item.name}`}
            className="h-8 w-8 text-lg text-ink disabled:opacity-30"
          >
            −
          </button>
          <span className="num w-6 text-center font-semibold" aria-live="polite">
            {item.qty}
          </span>
          <button
            type="button"
            onClick={() => onQty(item.qty + 1)}
            disabled={item.qty >= MAX_QTY}
            aria-label={`One more ${item.name}`}
            className="h-8 w-8 text-lg text-ink disabled:opacity-30"
          >
            +
          </button>
        </div>
        {canSwap && (
          <button type="button" onClick={onSwap} className="text-sm font-semibold text-ink underline decoration-mist decoration-2 underline-offset-4 hover:decoration-ink">
            Swap
          </button>
        )}
        <button type="button" onClick={onRemove} className="text-sm text-ink-soft underline decoration-transparent underline-offset-4 hover:text-chilli hover:decoration-chilli">
          Remove
        </button>
      </div>
    </li>
  );
}
