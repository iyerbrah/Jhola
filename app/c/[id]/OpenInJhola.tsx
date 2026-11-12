"use client";

import type { Session } from "@/lib/cart/types";

/** Opens the shared cart in Jhola, where it can be changed by chatting. */
export function OpenInJhola({ session }: { session: Session }) {
  return (
    <button
      type="button"
      onClick={() => {
        try {
          sessionStorage.removeItem("jhola:chat:v1");
          sessionStorage.setItem("jhola:open", JSON.stringify(session));
        } catch {}
        window.location.href = "/";
      }}
      className="mt-6 w-full rounded-xl bg-marigold px-4 py-3 font-bold text-ink hover:bg-marigold-deep"
    >
      Open in Jhola and change it
    </button>
  );
}
