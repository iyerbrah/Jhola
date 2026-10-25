"use client";

import type { RefObject } from "react";

export const EXAMPLES = [
  "Paneer butter masala for 4",
  "Tasty Indian breakfast for 2",
  "Gift of 4 dark chocolates under ₹1000",
];

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (q: string) => void;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  chips?: string[];
};

export function QueryInput({ value, onChange, onSubmit, busy, inputRef, chips = EXAMPLES }: Props) {
  const tooShort = value.trim().length < 3;
  return (
    <div>
      <form
        className="flex gap-2 rounded-2xl border-2 border-ink bg-paper p-1.5 shadow-[5px_5px_0_var(--color-marigold),0_24px_50px_-24px_rgb(18_26_63/0.6)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tooShort && !busy) onSubmit(value.trim());
        }}
      >
        <label htmlFor="query" className="sr-only">
          What do you need to buy?
        </label>
        <input
          id="query"
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={300}
          autoComplete="off"
          placeholder="Rajma chawal for 3, under ₹400"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-lg text-ink placeholder:text-ink-soft focus:outline-none"
        />
        <button
          type="submit"
          disabled={tooShort || busy}
          className="shrink-0 rounded-xl bg-ink px-4 py-2 text-base font-bold text-on-ink transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Building…" : "Build carts"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Try an example">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy}
            onClick={() => {
              onChange(c);
              onSubmit(c);
            }}
            className="rounded-full border border-line bg-paper px-3 py-1 text-sm text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
