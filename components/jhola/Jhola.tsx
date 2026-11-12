"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { listText } from "@/lib/chat/client";
import { fitsDiet } from "@/lib/requirements";
import { isFood } from "@/lib/schema";
import type { Line } from "@/lib/cart/types";
import { rupees } from "../format";
import { Sheet } from "../Sheet";
import { SiteFooter } from "../SiteFooter";
import { useCatalog } from "../useCatalog";
import { CartPanel } from "./CartPanel";
import { ChatPanel } from "./ChatPanel";
import { CheckoutSheet, PickSheet, TraceSheet } from "./Sheets";
import { useJhola, type ChatTurnView } from "./useJhola";

export const EXAMPLES = ["Stuff for pasta night for 4, vegetarian, around ₹600", "Weekly veggies for 2, no onions", "Cleaning supplies for a new flat", "Gift of 4 dark chocolates under ₹1000"];

/** Jhola: one chat, one cart. The conversation on the left, the cart it builds on the right (a sheet on phones). */
export function Jhola({ catalogSize }: { catalogSize: number }) {
  const j = useJhola();
  const [picking, setPicking] = useState<Line | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [trace, setTrace] = useState<ChatTurnView | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const products = useCatalog(picking != null);

  const started = j.turns.length > 0 || j.now.cart.lines.length > 0;
  // While a turn streams, show what's arrived so far.
  const brief = j.live?.brief ?? j.now.session.brief;
  const needs = j.live?.needs ?? j.now.session.needs;
  const cart = j.live?.cart ?? j.now.cart;
  const checks = j.live?.checks ?? j.now.checks;
  const count = cart.lines.filter((l) => l.counted).length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(listText(j.now.session, j.now.cart));
      setShareNote("List copied");
    } catch {
      setShareNote("Couldn't copy here");
    }
  }
  async function share() {
    setShareNote("Making a link…");
    const r = await j.share();
    if (!r.ok) return setShareNote(r.error);
    const url = `${window.location.origin}${r.path}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareNote(`Link copied: ${r.path}`);
    } catch {
      setShareNote(url);
    }
  }

  const panel = (bare = false) => (
    <CartPanel
      bare={bare}
      brief={brief}
      needs={needs}
      plan={j.busy && !j.live?.needs ? (j.live?.plan ?? null) : null}
      cart={cart}
      checks={checks}
      busy={j.busy}
      planning={j.busy && !!j.live?.needs}
      flash={j.flash}
      onTap={(a, text) => void j.tap(a, text)}
      onSwap={setPicking}
      onCheckout={() => {
        setCartOpen(false);
        setCheckout(true);
      }}
      onCopy={copy}
      onShare={share}
      shareNote={shareNote}
    />
  );

  return (
    <div className="flex min-h-screen flex-col">
      <div className="hero-band">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <header className="flex items-center justify-between py-5">
            <button type="button" onClick={j.reset} className="font-display text-3xl leading-none text-on-ink" aria-label="Jhola: start a new cart">
              Jhola
            </button>
            <nav aria-label="Site" className="flex items-center gap-5 text-sm font-semibold">
              {process.env.NODE_ENV !== "production" && (
                <a href="/history" className="text-on-ink-soft underline decoration-on-ink-soft/40 underline-offset-4 hover:text-on-ink">
                  History
                </a>
              )}
              <Link href="/evals" className="text-on-ink-soft underline decoration-on-ink-soft/40 underline-offset-4 hover:text-on-ink">
                Results
              </Link>
              <Link href="/how-it-works" className="text-on-ink underline decoration-marigold decoration-2 underline-offset-4">
                How it works
              </Link>
            </nav>
          </header>
          {!started ? (
            <div className="grid items-end gap-10 pb-16 pt-6 sm:pt-12 lg:grid-cols-[1fr_380px] lg:pb-20">
              <div>
                <h1 className="rise max-w-3xl font-display text-5xl leading-[1.02] text-on-ink sm:text-7xl" style={{ "--i": 0 } as React.CSSProperties}>
                  What&apos;s on the list today?
                </h1>
                <p className="rise mt-5 max-w-xl text-lg leading-relaxed text-on-ink-soft" style={{ "--i": 1 } as React.CSSProperties}>
                  Tell Jhola what you need in one line. It builds a ready cart from {catalogSize.toLocaleString("en-IN")} real groceries and household essentials: in stock, the right amounts, within your budget. Then change anything by asking.
                </p>
              </div>
              <Preview />
            </div>
          ) : (
            <div className="pb-4" />
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        {!started ? (
          <div className="rise relative z-10 -mt-8 max-w-2xl" style={{ "--i": 2 } as React.CSSProperties}>
            <StartBox onSend={j.send} />
          </div>
        ) : (
          <>
            {/* Phones: the cart is one tap away. */}
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="sticky top-0 z-20 -mx-4 flex w-[calc(100%+2rem)] items-center justify-between gap-3 border-b border-line bg-chalk/95 px-4 py-2.5 text-left backdrop-blur lg:hidden"
            >
              <span className="font-semibold text-ink">
                Your cart <span className="font-normal text-ink-soft">· {count} items</span>
              </span>
              <span className="num font-display text-xl text-leaf">{rupees(cart.total)}</span>
            </button>
            <main className="grid gap-8 pt-6 lg:grid-cols-[minmax(0,1fr)_440px]">
              <ChatPanel
                turns={j.turns}
                busy={j.busy}
                canUndo={j.canUndo}
                onSend={j.send}
                onUndo={j.undo}
                onStop={j.stop}
                onConfirm={j.confirm}
                onDecline={j.decline}
                onTrace={setTrace}
                chips={followUps(j.now)}
                inputRef={inputRef}
              />
              <div className="hidden lg:block">
                <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pb-4 pr-1">{panel()}</div>
              </div>
            </main>
          </>
        )}
        <SiteFooter />
      </div>

      <Sheet open={cartOpen} onClose={() => setCartOpen(false)} title={`Your cart · ${rupees(cart.total)}`}>
        {panel(true)}
      </Sheet>
      <PickSheet
        line={picking}
        brief={j.now.session.brief}
        products={products}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          if (picking) void j.tap({ type: "pin", need_id: picking.need_id, product_id: p.id, qty: null }, `Swapped ${picking.product.name} for ${p.name}`);
          setPicking(null);
        }}
      />
      <CheckoutSheet
        open={checkout}
        cart={j.now.cart}
        title={j.now.session.brief.summary}
        onRecheck={j.recheck}
        onClose={() => setCheckout(false)}
        onDone={() => {
          setCheckout(false);
          j.reset();
        }}
      />
      <TraceSheet turn={trace} onClose={() => setTrace(null)} />
    </div>
  );
}

/** Next things to ask, from the cart itself: "Make it vegetarian" only when some food in it isn't. */
function followUps(now: ReturnType<typeof useJhola>["now"]): string[] {
  const lines = now.cart.lines.filter((l) => l.counted);
  if (!lines.length) return EXAMPLES.slice(0, 2);
  const b = now.session.brief;
  const chips: string[] = [];
  if (b.people) chips.push(`Make it for ${b.people + 2}`);
  if (!b.diet && lines.some((l) => isFood(l.product) && !fitsDiet(l.product, "veg"))) chips.push("Make it vegetarian");
  if (b.budget_inr == null && now.cart.total >= 200) chips.push(`Keep it under ₹${Math.floor((now.cart.total * 0.8) / 50) * 50}`);
  else if (b.quality !== "value") chips.push("Cheaper brands");
  chips.push(lines.some((l) => isFood(l.product)) ? "Add something for dessert" : "Anything I've missed?");
  return chips.slice(0, 4);
}

function StartBox({ onSend }: { onSend: (s: string) => void }) {
  const [text, setText] = useState("");
  const go = (s: string) => s.trim().length >= 3 && onSend(s.trim());
  return (
    <div>
      <form
        className="flex gap-2 rounded-2xl border-2 border-ink bg-paper p-1.5 shadow-[5px_5px_0_var(--color-marigold),0_24px_50px_-24px_rgb(18_26_63/0.6)]"
        onSubmit={(e) => {
          e.preventDefault();
          go(text);
        }}
      >
        <label htmlFor="start" className="sr-only">
          What do you need?
        </label>
        <input
          id="start"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          autoComplete="off"
          placeholder="Stuff for pasta night for 4, vegetarian"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-lg text-ink placeholder:text-ink-soft focus:outline-none"
        />
        <button type="submit" disabled={text.trim().length < 3} className="shrink-0 rounded-xl bg-ink px-4 py-2 font-bold text-on-ink hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-50">
          Build my cart
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Try an example">
        {EXAMPLES.map((c) => (
          <button key={c} type="button" onClick={() => go(c)} className="rounded-full border border-line bg-paper px-3 py-1 text-sm text-ink-soft transition-colors hover:border-ink hover:text-ink">
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The hero's card: what one line turns into, with the parts that make it trustworthy. Desktop only. */
function Preview() {
  const rows = [
    ["Penne pasta", "for the pasta", "₹108"],
    ["Tomatoes", "for the sauce", "₹9"],
    ["Fresh cream", "for the sauce", "₹67"],
    ["Cheese cubes", "to finish", "₹109"],
  ];
  return (
    <div className="rise relative z-20 hidden lg:-mb-32 lg:block" style={{ "--i": 2 } as React.CSSProperties}>
      <figure className="relative rotate-[-2.5deg] rounded-2xl bg-paper px-6 pb-5 pt-7 text-ink shadow-lift">
        <span className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 rotate-[4deg] bg-marigold/85" aria-hidden />
        <figcaption className="text-sm text-ink-soft">One line in</figcaption>
        <p className="font-display text-xl leading-tight">Pasta night for 4, vegetarian, around ₹600</p>
        <p className="mt-3 w-fit rounded-lg bg-marigold-soft px-2 py-1 text-xs text-marigold-text">
          <span className="font-semibold">I understood:</span> pasta night · 4 people · vegetarian · ₹600
        </p>
        <ul className="ruled mt-2">
          {rows.map(([name, why, price]) => (
            <li key={name} className="flex h-8 items-center justify-between gap-2">
              <span className="truncate font-semibold">
                {name} <span className="ml-1 rounded-full bg-leaf-soft px-1.5 py-0.5 text-[11px] font-semibold text-leaf">{why}</span>
              </span>
              <span className="num font-display text-lg">{price}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-leaf">✓ All in stock · ✓ Under ₹600 · ✓ Vegetarian · ✓ No duplicates</p>
      </figure>
    </div>
  );
}
