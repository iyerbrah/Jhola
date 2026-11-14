"use client";

import { button } from "@/components/ui";
import type { Session } from "@/lib/cart/types";

/** Opens the shared cart in Jhola, where it can be changed by chatting. */
export function OpenInJhola({ session, className = "mt-6" }: { session: Session; className?: string }) {
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
      className={button("primary", `w-full py-3 ${className}`)}
    >
      Open in Jhola and change it
    </button>
  );
}
