"use client";

import { useEffect, useRef, useState } from "react";
import { catalog } from "@/lib/catalog";
import { cartTotal, swapItem, swapOptions, toEditable, type CartItem, type EditableCart } from "@/lib/cartState";
import type { BuildCartsResponse } from "@/lib/schema";
import { CartCard } from "./CartCard";
import { rupees } from "./format";
import { QueryInput } from "./QueryInput";
import { Summary } from "./Summary";
import { SwapSheet } from "./SwapSheet";

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "done"; query: string; res: BuildCartsResponse }
  | { kind: "error"; query: string; status: number; message: string; retryAfter?: number };

/** Carts are sorted cheapest first: leaf, marigold, indigo. */
const TIERS = ["var(--color-leaf)", "var(--color-marigold)", "var(--color-ink)"];

const LOADING_LINES = ["Reading your request", "Planning three different carts", `Picking packs from ${catalog.length} products`, "Checking prices and stock"];

export function CartBuilder() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [carts, setCarts] = useState<EditableCart[]>([]);
  const [swapping, setSwapping] = useState<{ cart: number; item: CartItem } | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  const requestId = useRef(0);

  async function run(query: string) {
    const id = ++requestId.current;
    setPhase({ kind: "loading", query });
    setCarts([]);
    setActive(0);
    try {
      const r = await fetch("/api/build-carts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const body = await r.json().catch(() => ({}));
      if (id !== requestId.current) return; // a newer request replaced this one
      if (r.ok) {
        setPhase({ kind: "done", query, res: body });
        setCarts((body as BuildCartsResponse).variants.map(toEditable));
      } else {
        setPhase({ kind: "error", query, status: r.status, message: body.error ?? "Something went wrong.", retryAfter: body.retry_after });
      }
    } catch {
      if (id !== requestId.current) return;
      setPhase({ kind: "error", query, status: 0, message: "Couldn't reach Jhola. Check your connection and try again." });
    }
  }

  function editQuery(text: string) {
    setInput(text);
    window.scrollTo({ top: 0, behavior: "smooth" });
    inputRef.current?.focus();
  }

  function startOver() {
    setChosen(null);
    setCarts([]);
    setPhase({ kind: "idle" });
    editQuery("");
  }

  /** Scroll the cart row sideways to cart i (the page itself doesn't move). */
  function showCart(i: number) {
    const row = rowRef.current;
    const card = row?.children[i] as HTMLElement | undefined;
    if (row && card) row.scrollTo({ left: card.offsetLeft - row.offsetLeft - 16, behavior: "smooth" });
  }

  // On phones the carts scroll sideways; keep the comparison strip in sync.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const onScroll = () => {
      const card = row.firstElementChild as HTMLElement | null;
      if (card) setActive(Math.round(row.scrollLeft / (card.offsetWidth + 16)));
    };
    row.addEventListener("scroll", onScroll, { passive: true });
    return () => row.removeEventListener("scroll", onScroll);
  }, [carts.length]);

  // Keep the active pill visible in the strip (sideways only).
  useEffect(() => {
    const strip = stripRef.current;
    const pill = strip?.children[active] as HTMLElement | undefined;
    if (strip && pill) strip.scrollTo({ left: pill.offsetLeft - strip.offsetLeft - 16, behavior: "smooth" });
  }, [active]);

  const busy = phase.kind === "loading";
  const res = phase.kind === "done" ? phase.res : null;
  const swapCart = swapping ? carts[swapping.cart] : null;

  const idle = phase.kind === "idle";

  return (
    <div className="flex min-h-screen flex-col">
      <div className="hero-band">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <header className="flex items-center justify-between py-5">
            <button type="button" onClick={startOver} className="font-display text-3xl leading-none text-on-ink">
              Jhola
            </button>
            {process.env.NODE_ENV === "production" ? (
              <p className="hidden text-sm text-on-ink-soft sm:block">Three ready carts from one sentence</p>
            ) : (
              // Only on your machine: the generation log with costs.
              <a href="/history" className="text-sm font-semibold text-on-ink underline decoration-marigold decoration-2 underline-offset-4">
                History and costs
              </a>
            )}
          </header>

          {idle ? (
            <div className="grid items-end gap-10 pb-20 pt-6 sm:pt-14 lg:grid-cols-[1fr_360px] lg:pb-24">
              <div>
                <h1 className="rise max-w-3xl font-display text-5xl leading-[1.02] text-on-ink sm:text-7xl" style={{ "--i": 0 } as React.CSSProperties}>
                  What&apos;s on the list today?
                </h1>
                <p className="rise mt-5 max-w-lg text-lg leading-relaxed text-on-ink-soft" style={{ "--i": 1 } as React.CSSProperties}>
                  Describe a dish, a meal or an occasion. Jhola builds three ready-to-order carts from {catalog.length.toLocaleString("en-IN")} real grocery products, with quantities and totals worked out.
                </p>
              </div>
              <ListPreview />
            </div>
          ) : (
            <div className="pb-12" />
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <div className="rise relative z-10 -mt-9 max-w-2xl lg:max-w-[600px]" style={{ "--i": idle ? 2 : 0 } as React.CSSProperties}>
          <QueryInput value={input} onChange={setInput} onSubmit={run} busy={busy} inputRef={inputRef} />
        </div>

        <main className="pt-8">

        {phase.kind === "loading" && <Loading />}

        {phase.kind === "error" && <ErrorState phase={phase} onRetry={() => run(phase.query)} />}

        {res?.status === "cannot_fulfil" && (
          <section className="max-w-2xl rounded-3xl border-2 border-ink bg-paper p-6">
            <h2 className="font-display text-2xl">No carts for this one</h2>
            <p className="mt-2 text-lg">{res.message}</p>
            {res.suggestions.length > 0 && (
              <>
                <p className="mt-4 text-ink-soft">Jhola can help with things like:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {res.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setInput(s);
                        run(s);
                      }}
                      className="rounded-full border-2 border-ink px-3 py-1 font-medium hover:bg-mist"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {res && res.status !== "cannot_fulfil" && carts.length > 0 && (
          <section aria-label="Your carts">
            <div className="mb-2 max-w-3xl space-y-2">
              {res.assumptions.length > 0 && (
                <p className="text-ink-soft">
                  {res.assumptions.join(". ")}.{" "}
                  <button type="button" onClick={() => editQuery(phase.kind === "done" ? phase.query : "")} className="font-semibold text-ink underline underline-offset-4">
                    Change
                  </button>
                </p>
              )}
              {res.status === "partial" && res.message && (
                <p role="status" className="rounded-2xl border-l-4 border-marigold bg-paper px-4 py-3">
                  {res.message}
                </p>
              )}
            </div>

            {/* Phones: a strip to compare totals and jump between carts */}
            <nav ref={stripRef} aria-label="Compare carts" className="sticky top-0 z-10 -mx-4 mb-1 flex gap-2 overflow-x-auto bg-chalk/95 px-4 py-2 backdrop-blur lg:hidden">
              {carts.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => showCart(i)}
                  aria-current={active === i}
                  className={`shrink-0 rounded-full border-2 px-3 py-1 text-sm ${active === i ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink"}`}
                >
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: TIERS[i] }} aria-hidden />
                  {c.name} <span className="num font-semibold">{rupees(cartTotal(c))}</span>
                </button>
              ))}
            </nav>

            <div
              ref={rowRef}
              className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:items-start lg:overflow-visible lg:px-0"
            >
              {carts.map((c, i) => (
                // Carts rise in one after another; on desktop the middle one sits lower to break the grid.
                <div
                  key={i}
                  className={`rise w-[88%] max-w-sm shrink-0 snap-start sm:w-[60%] lg:w-auto lg:max-w-none ${i === 1 ? "lg:mt-10" : ""}`}
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <CartCard
                    id={`cart-${i}`}
                    tier={TIERS[i] ?? TIERS[2]}
                    cart={c}
                    onChange={(next) => setCarts((cs) => cs.map((x, j) => (j === i ? next : x)))}
                    onSwap={(item) => setSwapping({ cart: i, item })}
                    onChoose={() => setChosen(i)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}
        </main>

        <footer className="mt-16 border-t border-line py-6 text-sm text-ink-soft">
          <p>
            Product data from the Kaggle &quot;BigBasket Entire Product List&quot; dataset (CC BY-NC-SA 4.0), plus a few hand-added staples. Prices are an illustrative snapshot, not live prices.
          </p>
          <p className="mt-1">Jhola is a portfolio demo. It is not affiliated with any retailer, and no orders are placed.</p>
        </footer>
      </div>

      <SwapSheet
        item={swapping?.item ?? null}
        options={swapping && swapCart ? swapOptions(swapCart, swapping.item, catalog) : []}
        onClose={() => setSwapping(null)}
        onPick={(p) => {
          if (!swapping) return;
          setCarts((cs) => cs.map((c, j) => (j === swapping.cart ? swapItem(c, swapping.item.product_id, p) : c)));
          setSwapping(null);
        }}
      />
      <Summary cart={chosen != null ? carts[chosen] : null} onClose={() => setChosen(null)} onStartOver={startOver} />
    </div>
  );
}

function Loading() {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLine((l) => Math.min(l + 1, LOADING_LINES.length - 1)), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <section aria-busy="true" aria-label="Building your carts">
      <p role="status" className="mb-2 text-ink-soft">
        {LOADING_LINES[line]}…
      </p>
      <div className="-mx-4 flex gap-4 overflow-hidden px-4 lg:mx-0 lg:grid lg:grid-cols-3 lg:px-0">
        {[0, 1, 2].map((i) => (
          <div key={i} className="relative mt-6 w-[88%] max-w-sm shrink-0 rounded-3xl border-2 border-line bg-paper p-5 sm:w-[60%] lg:w-auto lg:max-w-none">
            <div className="skeleton h-7 w-2/3" />
            <div className="skeleton mt-3 h-4 w-full" />
            {[0, 1, 2, 3, 4].map((j) => (
              <div key={j} className="mt-6 flex justify-between gap-4">
                <div className="flex-1">
                  <div className="skeleton h-4 w-3/4" />
                  <div className="skeleton mt-2 h-3 w-1/2" />
                </div>
                <div className="skeleton h-4 w-12" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ErrorState({ phase, onRetry }: { phase: Extract<Phase, { kind: "error" }>; onRetry: () => void }) {
  if (phase.status === 429) {
    const minutes = Math.max(1, Math.ceil((phase.retryAfter ?? 60) / 60));
    return (
      <section role="alert" className="max-w-2xl rounded-3xl border-2 border-ink bg-paper p-6">
        <h2 className="font-display text-2xl">Too many requests</h2>
        <p className="mt-2 text-lg">
          Try again in {minutes} {minutes === 1 ? "minute" : "minutes"}. Jhola limits how often each person can build carts, to keep the demo free to run.
        </p>
      </section>
    );
  }
  return (
    <section role="alert" className="max-w-2xl rounded-3xl border-2 border-chilli bg-chilli-soft p-6">
      <h2 className="font-display text-2xl text-chilli">Carts weren&apos;t built</h2>
      <p className="mt-2 text-lg">{phase.message}</p>
      {phase.status !== 400 && (
        <button type="button" onClick={onRetry} className="mt-4 rounded-xl bg-ink px-4 py-2.5 font-bold text-paper hover:bg-ink-soft">
          Retry
        </button>
      )}
    </section>
  );
}

/** The hero's shopping-list card: shows what one line turns into. Desktop only. */
function ListPreview() {
  const rows = [
    { name: "Budget", total: 285, tier: TIERS[0] },
    { name: "Shortcut", total: 594, tier: TIERS[1] },
    { name: "Classic", total: 934, tier: TIERS[2] },
  ];
  return (
    <div className="rise relative z-20 hidden lg:-mb-40 lg:block" style={{ "--i": 2 } as React.CSSProperties}>
      <figure className="relative rotate-[-3deg] rounded-2xl bg-paper px-6 pb-5 pt-7 text-ink shadow-lift">
        <span className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 rotate-[4deg] bg-marigold/85" aria-hidden />
        <figcaption className="text-sm text-ink-soft">One line in</figcaption>
        <p className="font-display text-xl leading-tight">
          Paneer butter masala <span className="whitespace-nowrap">for 4</span>
        </p>
        <p className="mt-4 text-sm text-ink-soft">Three carts out</p>
        <ul className="ruled mt-1">
          {rows.map((r) => (
            <li key={r.name} className="flex h-8 items-center justify-between">
              <span className="flex items-center gap-2 font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.tier }} aria-hidden />
                {r.name}
              </span>
              <span className="num font-display text-lg">{rupees(r.total)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-soft">Packs sized for 4 people. Every total checked by code.</p>
      </figure>
    </div>
  );
}
