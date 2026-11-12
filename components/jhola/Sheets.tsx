"use client";

import { useEffect, useState } from "react";
import { blockedBy } from "@/lib/cart/solve";
import { isSameKind } from "@/lib/kind";
import type { CartDiff } from "@/lib/cart/diff";
import type { Brief, Cart, Line } from "@/lib/cart/types";
import { changeParts } from "@/lib/chat/client";
import { packLabel, type Product } from "@/lib/schema";
import { rupees } from "../format";
import { Sheet } from "../Sheet";
import { button, PriceTag } from "../ui";
import type { ChatTurnView } from "./useJhola";

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

/** Review & checkout: re-checks stock first (anything that sold out is swapped and shown), then a demo order. */
export function CheckoutSheet({
  open,
  cart,
  title,
  onRecheck,
  onClose,
  onDone,
}: {
  open: boolean;
  cart: Cart;
  title: string;
  onRecheck: () => Promise<CartDiff | null>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [state, setState] = useState<{ kind: "checking" } | { kind: "ready"; changed: CartDiff | null } | { kind: "placed"; no: string }>({ kind: "checking" });
  useEffect(() => {
    if (!open) return;
    setState({ kind: "checking" });
    let live = true;
    onRecheck().then((changed) => live && setState({ kind: "ready", changed }));
    return () => {
      live = false;
    };
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const items = cart.lines.filter((l) => l.counted);

  if (state.kind === "placed") {
    return (
      <Sheet open={open} onClose={onClose} title="Order placed">
        <p className="text-lg">
          Order <span className="num font-semibold">{state.no}</span> for <span className="num font-semibold">{rupees(cart.total)}</span>.
        </p>
        <p className="mt-2 text-ink-soft">This is a demo, so nothing was charged and nothing will be delivered. Jhola never asks for an address or payment details.</p>
        <button type="button" onClick={onDone} className={button("primary", "mt-6 w-full py-3")}>
          Start a new cart
        </button>
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} title={title || "Your cart"}>
      {state.kind === "checking" && (
        <p role="status" className="mb-3 text-ink-soft">
          Checking stock and prices…
        </p>
      )}
      {state.kind === "ready" && (
        <p role="status" className={`mb-3 rounded-md px-3 py-2 text-sm ${state.changed ? "border-l-4 border-turmeric bg-turmeric-soft text-turmeric-text" : "bg-sign-soft font-semibold text-sign"}`}>
          {state.changed
            ? `Stock changed while you shopped: ${changeParts(state.changed)
                .map((p) => p.text)
                .join(", ")}.`
            : "✓ Everything is in stock at these prices."}
        </p>
      )}
      <ul className="divide-y divide-line">
        {items.map((l) => (
          <li key={`${l.need_id}:${l.product.id}`} className="flex justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="font-medium">{l.product.name}</span>
              <span className="block text-sm text-ink-soft">
                {l.packs} × {l.product.brand}, {l.product.pack_label} at <span className="num">{rupees(l.product.price)}</span>
              </span>
            </span>
            <span className="num shrink-0 font-semibold">{rupees(l.line_total)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t-2 border-sign pt-4">
        <span className="font-semibold">
          Total for {items.length} {items.length === 1 ? "item" : "items"}
        </span>
        <PriceTag amount={cart.total} size="lg" label="Total" />
      </div>
      <button
        type="button"
        disabled={state.kind === "checking"}
        onClick={() => setState({ kind: "placed", no: `JH-${Math.floor(100000 + Math.random() * 900000)}` })}
        className={button("buy", "mt-6 w-full")}
      >
        Place order (demo)
      </button>
      <button type="button" onClick={onClose} className="mt-2 w-full rounded-md px-4 py-2 text-ink-soft hover:bg-wall hover:text-ink">
        Keep shopping
      </button>
    </Sheet>
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
              ? "Answered from the cache: no model call."
              : `${m.model_calls} model call${m.model_calls === 1 ? "" : "s"} and ${m.tool_calls} tool call${m.tool_calls === 1 ? "" : "s"} in ${(m.latency_ms / 1000).toFixed(1)} s, for ₹${m.cost_inr?.toFixed(2) ?? "–"} ($${m.cost_usd?.toFixed(4) ?? "–"}).`}
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
                  {s.kind === "model" && s.input_tokens ? ` · ${s.input_tokens.toLocaleString("en-IN")} in (${(s.cached_tokens ?? 0).toLocaleString("en-IN")} cached) · ${s.output_tokens} out` : ""}
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
