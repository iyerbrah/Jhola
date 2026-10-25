"use client";

import { catalog } from "@/lib/catalog";
import { cartTotal, removeItem, setQty, swapOptions, toggleOptional, type CartItem, type EditableCart } from "@/lib/cartState";
import { rupees } from "./format";
import { ItemRow } from "./ItemRow";

type Props = {
  id: string;
  /** CSS colour for this cart's price tier (handle and top edge). */
  tier: string;
  cart: EditableCart;
  onChange: (cart: EditableCart) => void;
  onSwap: (item: CartItem) => void;
  onChoose: () => void;
};

export function CartCard({ id, tier, cart, onChange, onSwap, onChoose }: Props) {
  const required = cart.items.filter((it) => !it.optional);
  const optional = cart.items.filter((it) => it.optional);
  const total = cartTotal(cart);
  const empty = required.length === 0 && !optional.some((it) => it.included);

  return (
    <article
      id={id}
      aria-label={`${cart.name} cart`}
      className="relative mt-6 flex flex-col rounded-3xl border-2 border-t-[6px] border-ink bg-paper shadow-lift"
      style={{ "--tier": tier, borderTopColor: tier } as React.CSSProperties}
    >
      <span className="jhola-handle" aria-hidden />

      <header className="border-b border-line px-5 pb-4 pt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-2xl leading-tight text-ink">{cart.name}</h2>
          <p className="num font-display text-2xl text-leaf">{rupees(total)}</p>
        </div>
        <p className="mt-1 text-ink-soft">{cart.reason}</p>
      </header>

      <div className="flex-1 px-5">
        {required.length > 0 ? (
          <ul className="divide-y divide-line">
            {required.map((it) => (
              <ItemRow
                key={it.product_id}
                item={it}
                canSwap={swapOptions(cart, it, catalog).length > 0}
                onQty={(q) => onChange(setQty(cart, it.product_id, q))}
                onRemove={() => onChange(removeItem(cart, it.product_id))}
                onSwap={() => onSwap(it)}
              />
            ))}
          </ul>
        ) : (
          <p className="py-6 text-ink-soft">You removed everything from this cart.</p>
        )}

        {optional.length > 0 && (
          <section className="mb-2 mt-1 rounded-2xl bg-chalk px-4 py-3" aria-label="You may already have">
            <h3 className="font-semibold text-ink">You may already have</h3>
            <p className="text-sm text-ink-soft">Tick anything you need to add it.</p>
            <ul className="mt-2 space-y-1">
              {optional.map((it) => (
                <li key={it.product_id}>
                  <label className="flex cursor-pointer items-center gap-3 py-1">
                    <input
                      type="checkbox"
                      checked={it.included}
                      aria-label={`Add ${it.name}, ${it.brand} ${it.pack_label}`}
                      onChange={() => onChange(toggleOptional(cart, it.product_id))}
                      className="h-5 w-5 shrink-0 accent-ink"
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-medium text-ink">{it.name}</span>
                      <span className="text-ink-soft">, {it.brand} {it.pack_label}</span>
                    </span>
                    <span className="num shrink-0 text-sm text-ink-soft">{rupees(it.price * it.qty)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t-2 border-ink px-5 py-4">
        <div>
          <p className="text-sm text-ink-soft">Total</p>
          <p className="num font-display text-2xl leading-none text-ink">{rupees(total)}</p>
        </div>
        <button
          type="button"
          onClick={onChoose}
          disabled={empty}
          className="rounded-xl bg-ink px-4 py-2.5 font-bold text-paper hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          Choose this cart
        </button>
      </footer>
    </article>
  );
}
