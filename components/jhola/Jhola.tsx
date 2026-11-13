"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { listText } from "@/lib/chat/client";
import { fitsDiet } from "@/lib/requirements";
import { isFood } from "@/lib/schema";
import type { Line } from "@/lib/cart/types";
import { Sheet } from "../Sheet";
import { SiteFooter } from "../SiteFooter";
import { SiteHeader } from "../SiteHeader";
import { button, chip, PANEL, PriceTag } from "../ui";
import { useCatalog } from "../useCatalog";
import { CartPanel } from "./CartPanel";
import { ChatPanel } from "./ChatPanel";
import { OrderedSheet, PickSheet, TraceSheet } from "./Sheets";
import { useJhola, type ChatTurnView, type Placed } from "./useJhola";

export const EXAMPLES = ["Stuff for pasta night for 4, vegetarian, around ₹600", "Weekly veggies for 2, no onions", "Cleaning supplies for a new flat", "Gift of 4 dark chocolates under ₹1000"];

/** Jhola: one chat, one cart. The conversation on the left, the cart it builds on the right (a sheet on phones). */
export function Jhola({ catalogSize }: { catalogSize: number }) {
  const j = useJhola();
  const [picking, setPicking] = useState<Line | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
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
      onOrder={() => {
        setCartOpen(false);
        setPlaced(j.order());
      }}
      onCopy={copy}
      onShare={share}
      shareNote={shareNote}
    />
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader current="home" onHome={j.reset}>
        {!started && (
          <div className="grid items-start gap-10 pb-14 pt-6 sm:pt-10 lg:grid-cols-[1fr_360px] lg:pb-16">
            <div>
              <h1 className="painted max-w-3xl text-[3rem] leading-[0.98] sm:text-[5.5rem]">What&apos;s on the list today?</h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-on-sign-soft sm:text-[1.1875rem]">
                Tell Jhola what you need in one line. It fills one cart from {catalogSize.toLocaleString("en-IN")} real groceries and household essentials: in stock, the right amounts, within your
                budget. Then change anything by asking.
              </p>
            </div>
            <Preview />
          </div>
        )}
      </SiteHeader>

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        {!started ? (
          // Same columns as the sign, so the box never runs under the hanging board.
          <div className="grid gap-10 pt-8 sm:pt-10 lg:grid-cols-[1fr_360px]">
            <div className="max-w-2xl">
              <StartBox onSend={j.send} />
            </div>
          </div>
        ) : (
          <>
            {/* Phones: the cart is one tap away. */}
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="sticky top-0 z-20 -mx-4 flex w-[calc(100%+2rem)] items-center justify-between gap-3 border-b-2 border-sign bg-paper px-4 py-2.5 text-left lg:hidden"
            >
              <span className="flex flex-col leading-tight">
                <span className="font-semibold text-ink">Your cart</span>
                <span className="text-sm text-ink-soft">
                  {count} {count === 1 ? "item" : "items"}, tap to open
                </span>
              </span>
              <PriceTag amount={cart.total} size="sm" label="Cart total" />
            </button>
            <main className="grid gap-8 pt-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:pt-8">
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
      </div>
      <SiteFooter />

      <Sheet open={cartOpen} onClose={() => setCartOpen(false)} title="Your cart">
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
      <OrderedSheet
        placed={placed}
        onDone={() => {
          setPlaced(null);
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
        className={`${PANEL} flex gap-2 p-1.5 focus-within:border-rani`}
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
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-lg text-ink placeholder:text-ink-soft focus:outline-none"
        />
        <button type="submit" disabled={text.trim().length < 3} className={button("primary", "shrink-0")}>
          Build my cart
        </button>
      </form>
      <p className="mt-2 text-sm text-ink-soft">
        Runs are listed on the public{" "}
        <Link href="/history" className={button("quiet-soft")}>
          History
        </Link>{" "}
        page. Your messages are not shown.
      </p>
      <p className="mt-5 text-sm font-semibold text-ink-soft">Or start with one of these</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((c) => (
          <button key={c} type="button" onClick={() => go(c)} className={chip("suggest")}>
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The sign's rate board: what one line turns into, hung from the signboard on two strings. Desktop only. */
function Preview() {
  const rows = [
    ["Penne pasta", "for the pasta", "₹108"],
    ["Tomatoes", "for the sauce", "₹9"],
    ["Fresh cream", "for the sauce", "₹67"],
    ["Cheese cubes", "to finish", "₹109"],
  ];
  return (
    <div className="relative z-20 hidden lg:-mb-44 lg:block">
      <figure className="relative mt-10 rotate-[-1.5deg] rounded-md border-2 border-sign-deep bg-paper px-5 pb-5 pt-5 text-ink">
        {/* The strings it hangs from. */}
        <span className="absolute -top-12 left-10 h-12 w-0.5 rotate-[8deg] bg-sign-deep" aria-hidden />
        <span className="absolute -top-12 right-10 h-12 w-0.5 rotate-[-8deg] bg-sign-deep" aria-hidden />
        <figcaption className="text-sm text-ink-soft">One line in</figcaption>
        <p className="mt-0.5 text-xl font-bold leading-tight">Pasta night for 4, vegetarian, around ₹600</p>
        <p className="mt-3 rounded-r-md border-l-4 border-turmeric bg-turmeric-soft px-2.5 py-1.5 text-sm text-turmeric-text">
          <span className="font-semibold">I understood:</span> pasta night, 4 people, vegetarian, ₹600
        </p>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {rows.map(([name, why, price]) => (
            <li key={name} className="flex items-center justify-between gap-2 py-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold">{name}</span>
                <span className="rounded-full bg-sign-soft px-2 py-0.5 text-xs font-semibold text-sign">{why}</span>
              </span>
              <span className="num font-semibold">{price}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-end justify-between gap-3">
          <ul className="text-sm font-semibold text-sign">
            <li>✓ All in stock</li>
            <li>✓ Under ₹600</li>
            <li>✓ Vegetarian</li>
          </ul>
          <span className="price-tag num text-3xl">₹293</span>
        </div>
      </figure>
    </div>
  );
}
