import type { ReactNode } from "react";
import { rupees } from "./format";

/*
 * The few pieces every page shares, so a button or a chip looks the same wherever it appears.
 * Corners follow the role: panels and buttons 6px, chips round, the price tag its own shape.
 */

type ButtonKind = "primary" | "buy" | "secondary" | "quiet" | "quiet-soft";

const BUTTON: Record<ButtonKind, string> = {
  // Painted-sign green: the main action of a view.
  primary: "rounded-md bg-sign px-4 py-2.5 font-bold text-on-sign hover:bg-sign-deep",
  // Turmeric, the price tag's colour: only for ordering (I'm ready to order).
  buy: "rounded-md bg-turmeric px-4 py-3 font-bold text-ink hover:bg-turmeric-deep",
  secondary: "rounded-md border-2 border-sign bg-paper px-4 py-2 font-semibold text-sign hover:bg-sign-soft",
  quiet: "font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-rani",
  // A small link beside content (How I picked this, a reply's trace): grey until pointed at.
  "quiet-soft": "text-ink-soft underline decoration-line decoration-2 underline-offset-4 hover:text-ink hover:decoration-rani",
};

/** Class names for a button (or a link that looks like one). */
export function button(kind: ButtonKind, extra = ""): string {
  return `${BUTTON[kind]} transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${extra}`.trim();
}

/** Class names for a chip: a suggestion to send, or one of the shopper's preferences. */
export function chip(kind: "suggest" | "pref" | "diet" | "add" | "selected" = "suggest", extra = ""): string {
  const base = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm";
  const k = {
    suggest: "border-line bg-paper text-ink hover:border-sign hover:bg-sign-soft",
    pref: "border-sign bg-paper font-semibold text-ink",
    diet: "border-sign bg-sign-soft font-semibold text-sign",
    add: "border-dashed border-ink-soft text-ink-soft hover:border-sign hover:text-sign",
    // The chosen one of a set of filters.
    selected: "border-sign bg-sign-soft font-semibold text-sign",
  }[kind];
  return `${base} ${k} transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${extra}`.trim();
}

/** The one main object of a view (the cart, the composer, the start box): paper with the sign's green edge. */
export const PANEL = "rounded-md border-2 border-sign bg-paper";

/** A repeated or secondary block (a chart, a turn, a table of numbers): paper with a quiet edge. */
export const CARD = "rounded-md border-2 border-line bg-paper p-5 sm:p-6";

/** A heading inside a section or a card. */
export const H3 = "wide font-semibold text-ink";

/** A text field, its label, and the message under it when what was typed is wrong. */
export const LABEL = "block font-semibold text-ink";
export const INPUT = "mt-1.5 block w-full rounded-md border-2 border-line bg-paper px-3 py-2 text-ink focus:border-sign";
export const FIELD_ERROR = "text-sm font-semibold text-chilli";

export type Tone = "good" | "warn" | "bad" | "neutral" | "outline" | "on-sign";
const TONE: Record<Tone, string> = {
  good: "bg-sign-soft text-sign",
  warn: "bg-turmeric-soft text-turmeric-text",
  bad: "bg-chilli-soft text-chilli",
  neutral: "bg-wall text-ink-soft",
  outline: "border border-ink-soft text-ink-soft",
  // An outline tag on the green sign.
  "on-sign": "border border-on-sign-soft text-on-sign",
};

/** A small status tag: Done, Ready to order, Gave up, Ordered. Good is green, warn turmeric, bad chilli. */
export function tag(tone: Tone, extra = ""): string {
  return `inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-semibold ${TONE[tone]} ${extra}`.trim();
}

/**
 * The total you pay, on a turmeric tag. It swings when the amount changes (the key remounts it),
 * so a change to the cart is felt where the money is.
 */
export function PriceTag({ amount, size = "md", label }: { amount: number; size?: "sm" | "md" | "lg"; label?: string }) {
  const s = { sm: "text-lg", md: "text-2xl", lg: "text-4xl" }[size];
  return (
    <span key={amount} className={`price-tag tag-swing num ${s}`}>
      {label && <span className="sr-only">{label}: </span>}
      {rupees(amount)}
    </span>
  );
}

/** A short message in place of content: nothing yet, or something can't be reached. */
export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return <p className={`mt-8 max-w-2xl rounded-r-md border-l-4 bg-paper px-4 py-3 text-lg ${tone === "warn" ? "border-chilli" : "border-turmeric"}`}>{children}</p>;
}

/** A section heading on the wall: the sign face in ink. */
export const H2 = "font-sign text-[1.75rem] leading-tight text-ink sm:text-[2rem]";

/**
 * Numbers in a row, like the rates painted on a stall's board: a thick green rule over each,
 * the value in the sign face, what it means under it. Not boxed cards.
 */
export function StatBoard({ items, cols = 3 }: { items: [label: string, value: string, note?: string][]; cols?: 2 | 3 | 4 | 6 }) {
  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4", 6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" }[cols];
  return (
    <dl className={`grid gap-x-6 gap-y-6 ${grid}`}>
      {items.map(([label, value, note]) => (
        <div key={label} className="border-t-[3px] border-sign pt-2.5">
          <dt className="text-sm font-semibold text-ink">{label}</dt>
          <dd className="num mt-1 font-sign text-[2rem] leading-none text-ink">{value}</dd>
          {note && <dd className="mt-1.5 text-sm text-ink-soft">{note}</dd>}
        </div>
      ))}
    </dl>
  );
}
