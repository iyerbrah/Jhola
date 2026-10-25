"use client";

import { useState } from "react";
import { cartTotal, orderedItems, type EditableCart } from "@/lib/cartState";
import { rupees } from "./format";
import { Sheet } from "./Sheet";

type Props = { cart: EditableCart | null; onClose: () => void; onStartOver: () => void };

function fakeOrderNumber(): string {
  return `JH-${Math.floor(100000 + Math.random() * 900000)}`;
}

export function Summary({ cart, onClose, onStartOver }: Props) {
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const close = () => {
    setOrderNo(null);
    onClose();
  };

  if (orderNo && cart) {
    return (
      <Sheet open onClose={close} title="Order placed">
        <p className="text-lg">
          Order <span className="num font-semibold">{orderNo}</span> for <span className="num font-semibold">{rupees(cartTotal(cart))}</span>.
        </p>
        <p className="mt-2 text-ink-soft">This is a demo, so nothing was charged and nothing will be delivered.</p>
        <button
          type="button"
          onClick={() => {
            setOrderNo(null);
            onStartOver();
          }}
          className="mt-5 w-full rounded-xl bg-marigold px-4 py-3 font-bold text-ink hover:bg-marigold-deep"
        >
          Build another cart
        </button>
      </Sheet>
    );
  }

  const items = cart ? orderedItems(cart) : [];
  return (
    <Sheet open={!!cart} onClose={close} title={cart ? cart.name : "Your cart"}>
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.product_id} className="flex justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="font-medium">{it.name}</span>
              <span className="block text-sm text-ink-soft">
                {it.qty} × {it.brand}, {it.pack_label} at <span className="num">{rupees(it.price)}</span>
              </span>
            </span>
            <span className="num shrink-0 font-semibold">{rupees(it.price * it.qty)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-baseline justify-between border-t-2 border-ink pt-3">
        <span className="font-semibold">
          Total for {items.length} {items.length === 1 ? "item" : "items"}
        </span>
        <span className="num font-display text-3xl text-leaf">{cart ? rupees(cartTotal(cart)) : ""}</span>
      </div>
      <button type="button" onClick={() => setOrderNo(fakeOrderNumber())} className="mt-5 w-full rounded-xl bg-marigold px-4 py-3 font-bold text-ink hover:bg-marigold-deep">
        Place order
      </button>
      <button type="button" onClick={close} className="mt-2 w-full rounded-xl px-4 py-2 text-ink-soft hover:text-ink">
        Back to carts
      </button>
    </Sheet>
  );
}
