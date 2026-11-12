import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { catalog, catalogIndex } from "@/lib/catalog";
import { diffCarts } from "@/lib/cart/diff";
import type { Brief, Need, Session } from "@/lib/cart/types";
import { solveSession } from "@/lib/chat/loop";
import { Gallery } from "./Gallery";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "UI gallery", robots: { index: false } };

const need = (id: string, kind: string, amount: number, unit: Need["unit"], o: Partial<Need> = {}): Need => ({
  id,
  group: "pasta",
  label: id[0].toUpperCase() + id.slice(1),
  kind,
  amount,
  unit,
  per_person: true,
  role: "core",
  ticked: true,
  count: null,
  prefer: null,
  why: "",
  confidence: "sure",
  ...o,
});

/**
 * Every state of the chat and the cart on one page, from a cart the real solver builds over the real
 * catalog: no model call, so the UI can be checked for free. Development only, like /history.
 */
export default function UiGallery() {
  if (process.env.NODE_ENV === "production") notFound();

  const brief: Brief = {
    summary: "Pasta night, 4 people, vegetarian, around ₹600",
    people: 4,
    budget_inr: 600,
    diet: "veg",
    quality: "balanced",
    rules: [{ kind: "exclude_word", label: "No onions", value: "onion" } as Brief["rules"][number]],
    assumptions: ["Guessed 120 ml cream for 4", "Assumed you have salt and oil"],
    plan: [],
  };
  const needs: Need[] = [
    need("penne", "pasta", 100, "g", { label: "Penne", role: "main", why: "for the pasta" }),
    need("tomato", "tomato", 150, "g", { label: "Tomatoes", why: "for the sauce" }),
    need("cream", "cream", 30, "ml", { label: "Fresh cream", why: "for the sauce", confidence: "guess", prefer: "fresh cream" }),
    need("cheese", "cheese", 50, "g", { label: "Cheese", why: "to finish" }),
    need("garlic", "garlic", 10, "g", { label: "Garlic", why: "for the sauce" }),
    need("herbs", "herbs_seasoning", 1, "pack", { label: "Italian herbs", role: "extra", why: "for flavour", per_person: false }),
    need("bread", "bread", 1, "pack", { group: "on the side", label: "Garlic bread", role: "extra", why: "on the side", per_person: false, ticked: false }),
    need("oil", "olive_oil", 1, "pack", { group: "pantry", label: "Olive oil", role: "pantry", per_person: false, ticked: false }),
  ];
  const session: Session = { brief, needs, pins: [], picks: {}, choices: {} };
  const solved = solveSession(session, { products: catalog, index: catalogIndex });

  // Dress a few lines up with the rarer states, so each has something to look at.
  const lines = solved.cart.lines.map((l, i) => {
    if (l.need_id === "cheese") {
      return {
        ...l,
        substitution: { wanted: { id: "x1", name: "Cheese Cubes", brand: "D'Lecta", pack_label: l.product.pack_label, price: l.product.price - 21 }, reason: "out_of_stock" as const, delta_inr: 21 },
      };
    }
    if (l.need_id === "garlic") return { ...l, warnings: ["Garlic only comes in 250 g here, more than the 40 g needed"] };
    if (l.need_id === "herbs") return { ...l, flagged: true, pinned: true };
    return i === 0 ? l : l;
  });
  const cart = {
    ...solved.cart,
    lines,
    unmet: [{ need_id: "basil", label: "Fresh basil", detail: "none in stock" }],
    dropped: [{ need_id: "parmesan", label: "Parmesan" }],
  } as typeof solved.cart;
  const checks = [...solved.checks, { id: "pack", status: "warn" as const, label: "Garlic only comes in 250 g" }];
  const before = { ...cart, lines: cart.lines.slice(1), total: cart.total - 120 } as typeof cart;
  const diff = diffCarts(before, cart);

  return <Gallery session={solved.session} cart={cart} checks={checks} diff={diff} />;
}
