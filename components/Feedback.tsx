"use client";

import { useState } from "react";

type Props = {
  /** The answer's request_id. Without one (an old answer, an error) there's nothing to rate. */
  requestId?: string;
  target: "cart" | "reply";
  /** Which of the build's carts, for target "cart". */
  cart?: number;
  /** The question shown before a vote, e.g. "Good cart?". */
  label: string;
};

/** 👍 / 👎 on a cart or an agent reply. Shows the vote at once, and puts it back if saving fails. */
export function Feedback({ requestId, target, cart, label }: Props) {
  const [rating, setRating] = useState<-1 | 0 | 1>(0);
  const [failed, setFailed] = useState(false);
  if (!requestId) return null;

  async function vote(next: -1 | 1) {
    // Clicking the same thumb again takes the vote back.
    const value = rating === next ? 0 : next;
    const before = rating;
    setRating(value);
    setFailed(false);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request_id: requestId, target, ...(target === "cart" ? { cart } : {}), rating: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setRating(before);
      setFailed(true);
    }
  }

  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5 text-sm text-ink-soft">
      <span aria-live="polite">{failed ? "Couldn't save that" : rating === 0 ? label : "Thanks"}</span>
      <Thumb up pressed={rating === 1} onClick={() => vote(1)} />
      <Thumb up={false} pressed={rating === -1} onClick={() => vote(-1)} />
    </div>
  );
}

function Thumb({ up, pressed, onClick }: { up: boolean; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={up ? "Yes, good" : "No, not good"}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
        pressed ? "border-ink bg-ink text-on-ink" : "border-line bg-paper text-ink-soft hover:border-ink hover:text-ink"
      }`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden className={up ? "" : "rotate-180"}>
        <path
          fill="currentColor"
          d="M2 21h4V9H2v12Zm20-11a2 2 0 0 0-2-2h-6.3l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L13.17 1 7.59 6.59A1.98 1.98 0 0 0 7 8v11a2 2 0 0 0 2 2h9a2 2 0 0 0 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2Z"
        />
      </svg>
    </button>
  );
}
