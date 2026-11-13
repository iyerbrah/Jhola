"use client";

import { useRef, useState } from "react";
import type { CartDiff } from "@/lib/cart/diff";
import type { Cart, Check, Line, Session } from "@/lib/cart/types";
import { Sheet } from "@/components/Sheet";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { useCatalog } from "@/components/useCatalog";
import { CartPanel } from "@/components/jhola/CartPanel";
import { ChatPanel } from "@/components/jhola/ChatPanel";
import { OrderedSheet, PickSheet, TraceSheet } from "@/components/jhola/Sheets";
import type { Placed } from "@/components/jhola/useJhola";
import type { ChatTurnView, TurnView } from "@/components/jhola/useJhola";
import { OpenInJhola } from "@/app/c/[id]/OpenInJhola";

const meta = (id: string, cost: number): NonNullable<ChatTurnView["meta"]> => ({
  request_id: id,
  session_id: "gallery",
  latency_ms: 2300,
  model_calls: 1,
  tool_calls: 4,
  cost_usd: cost / 88,
  cost_inr: cost,
  finished_by: "code",
  cached: false,
  steps: [
    { kind: "model", name: "agent", ok: true, ms: 1900, input_tokens: 5120, cached_tokens: 4096, output_tokens: 310 },
    { kind: "tool", name: "update_brief", ok: true, ms: 1 },
    { kind: "tool", name: "set_needs", ok: true, ms: 2 },
    { kind: "tool", name: "what_if", ok: false, ms: 1, error: "No such need: basil" },
    { kind: "tool", name: "finish", ok: true, ms: 0 },
  ],
});

/** Renders the real components in every state they have. Taps are logged, not sent. */
export function Gallery({ session, cart, checks, diff }: { session: Session; cart: Cart; checks: Check[]; diff: CartDiff }) {
  const [picking, setPicking] = useState<Line | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [trace, setTrace] = useState<ChatTurnView | null>(null);
  const [sheet, setSheet] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const products = useCatalog(picking != null);
  const brief = session.brief;

  const turns: TurnView[] = [
    {
      id: 1,
      kind: "chat",
      message: "Stuff for pasta night for 4, vegetarian, around ₹600. No onions please",
      state: "done",
      progress: "",
      brief,
      reply: "Here's a vegetarian pasta night for 4 at ₹" + cart.total + ", under your ₹600. I skipped onions everywhere and guessed the cream.",
      diff: { ...diff, total_before: 0 },
      note: ["Guessed 120 ml cream for 4; change it if needed.", "Couldn't find fresh basil in stock."],
      meta: meta("r1", 0.48),
    },
    { id: 2, kind: "tap", text: "Tomatoes: 2 packs", diff: { ...diff, added: [], removed: [], swapped: [], packs: [{ product_id: "t", name: "Tomato", from: 1, to: 2 }] }, ms: 0.4 },
    { id: 3, kind: "chat", message: "Make it cheaper", state: "done", progress: "", reply: "Switched three lines to value brands.", diff, meta: meta("r3", 0.31) },
    {
      id: 4,
      kind: "chat",
      message: "Clear everything",
      state: "confirm",
      progress: "",
      reply: "That's a big change: it empties the cart. Want me to go ahead?",
      pending: { session, diff, reason: "it empties the cart" } as ChatTurnView["pending"],
    },
    {
      id: 5,
      kind: "chat",
      message: "Is the cream vegan?",
      state: "done",
      progress: "",
      reply: "Which would you like?",
      question: { question: "Swap to a vegan cream?", options: ["Yes, vegan cream", "Keep dairy"] },
      meta: meta("r5", 0.22),
    },
    { id: 6, kind: "chat", message: "Add garlic bread", state: "error", progress: "", reply: "Something went wrong, so your cart wasn't changed. Please try again." },
    { id: 7, kind: "tap", text: "Removed Garlic", diff, ms: 0.3, error: "Couldn't reach Jhola. Check your connection and try again." },
    { id: 8, kind: "chat", message: "Make it for 6", state: "working", progress: "Updating the plan", planned: 6 },
  ];

  const panel = (bare = false, extra: Partial<Parameters<typeof CartPanel>[0]> = {}) => (
    <CartPanel
      bare={bare}
      brief={brief}
      needs={session.needs}
      plan={null}
      cart={cart}
      checks={checks}
      busy={false}
      planning={false}
      flash={[cart.lines[1]?.product.id ?? ""]}
      onTap={(a, text) => console.log("tap", a, text)}
      onSwap={setPicking}
      onOrder={() => setPlaced(placeOrder(session, cart))}
      onCopy={() => {}}
      onShare={() => {}}
      shareNote={null}
      {...extra}
    />
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <p className="mt-6 max-w-2xl text-ink-soft">
          UI gallery, development only: the real chat and cart components in every state, over a cart the solver built from the real catalog. Taps go to the console.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" className="rounded-md border-2 border-sign px-3 py-1.5 font-semibold text-sign lg:hidden" onClick={() => setSheet(true)}>
            Open the cart sheet
          </button>
          <div className="w-64">
            <OpenInJhola session={session} />
          </div>
        </div>
        <main className="grid gap-8 pt-6 lg:grid-cols-[minmax(0,1fr)_440px]">
          <ChatPanel
            turns={turns}
            busy={false}
            canUndo={(t) => t.id !== 2}
            onSend={(s) => console.log("send", s)}
            onUndo={() => {}}
            onStop={() => {}}
            onConfirm={() => {}}
            onDecline={() => {}}
            onTrace={setTrace}
            chips={["Make it for 6", "Cheaper brands", "Add something for dessert"]}
            inputRef={inputRef}
          />
          <div className="space-y-8">
            {panel()}
            {panel(false, {
              plan: ["Penne, 400 g", "Tomatoes, 600 g", "Fresh cream", "Cheese", "Garlic"],
              busy: true,
              cart: { ...cart, lines: [], unmet: [], dropped: [], skipped: [], total: 0 },
              checks: [],
            })}
          </div>
        </main>
      </div>
      <SiteFooter />
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Your cart">
        {panel(true)}
      </Sheet>
      <PickSheet line={picking} brief={brief} products={products} onClose={() => setPicking(null)} onPick={() => setPicking(null)} />
      <OrderedSheet placed={placed} onDone={() => setPlaced(null)} />
      <TraceSheet turn={trace} onClose={() => setTrace(null)} />
    </div>
  );
}

/** Places a real order for the fixture cart (dev only), as its own run, so History can be checked without a model call. */
function placeOrder(session: Session, cart: Cart): Placed {
  const placed: Placed = { id: crypto.randomUUID(), number: `JH-${Math.floor(100000 + Math.random() * 900000)}`, total: cart.total, items: cart.lines.filter((l) => l.counted).length };
  void fetch("/api/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: placed.id, number: placed.number, session_id: crypto.randomUUID(), session, messages: 0 }),
  });
  return placed;
}
