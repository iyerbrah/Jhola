"use client";

import { useState } from "react";

const LABELS = ["", "1 star", "2 stars", "3 stars", "4 stars", "5 stars"];
/** What each rating means, said beside the stars once one is picked. */
const WORDS = ["", "Didn't work", "Needs work", "Okay", "Good", "Loved it"];

/**
 * One to five stars, as five real radio buttons: arrow keys move between them, and a screen reader hears
 * "3 stars". The star shapes are turmeric with an ink outline, so they keep their contrast on white.
 */
export function StarRating({ value, onChange, legend }: { value: number; onChange: (n: number) => void; legend: string }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset>
      <legend className="font-semibold text-ink">{legend}</legend>
      <div className="mt-2 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)}>
            <input
              type="radio"
              name="stars"
              value={n}
              checked={value === n}
              onChange={() => {
                // A choice (by click or arrow key) wins over the hover preview.
                setHover(0);
                onChange(n);
              }}
              className="peer sr-only"
            />
            <span className="sr-only">
              {LABELS[n]}, {WORDS[n]}
            </span>
            <svg
              viewBox="0 0 24 24"
              width="44"
              height="44"
              aria-hidden
              className="rounded-md transition-transform peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-rani peer-focus-visible:outline-solid motion-safe:hover:scale-110"
            >
              <path
                d="M12 2.8l2.83 5.74 6.33.92-4.58 4.46 1.08 6.3L12 17.25l-5.66 2.97 1.08-6.3-4.58-4.46 6.33-.92L12 2.8z"
                fill={n <= shown ? "var(--color-turmeric)" : "var(--color-paper)"}
                stroke="var(--color-ink)"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </label>
        ))}
        <span className={`ml-2 text-sm ${shown ? "font-semibold text-ink" : "text-ink-soft"}`} aria-hidden>
          {shown ? WORDS[shown] : "Tap a star"}
        </span>
      </div>
    </fieldset>
  );
}
