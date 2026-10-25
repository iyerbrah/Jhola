"use client";

import { packLabel, type Product } from "@/lib/schema";
import type { CartItem } from "@/lib/cartState";
import { rupees } from "./format";
import { Sheet } from "./Sheet";

type Props = { item: CartItem | null; options: Product[]; onPick: (p: Product) => void; onClose: () => void };

export function SwapSheet({ item, options, onPick, onClose }: Props) {
  return (
    <Sheet open={!!item} onClose={onClose} title={item ? `Swap ${item.name}` : "Swap"}>
      {item && (
        <>
          <p className="text-ink-soft">
            Now: {item.brand}, {item.pack_label} at <span className="num">{rupees(item.price)}</span>
          </p>
          <ul className="mt-3 divide-y divide-line">
            {options.map((p) => {
              const diff = p.price - item.price;
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onPick(p)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left hover:bg-chalk">
                    <span className="min-w-0">
                      <span className="block font-semibold">{p.name}</span>
                      <span className="block text-sm text-ink-soft">
                        {p.brand}, {packLabel(p)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block font-semibold">{rupees(p.price)}</span>
                      <span className={`num block text-sm ${diff < 0 ? "text-leaf" : "text-ink-soft"}`}>
                        {diff === 0 ? "same price" : diff < 0 ? `${rupees(-diff)} less` : `${rupees(diff)} more`}
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
