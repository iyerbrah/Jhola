"use client";

import { button } from "@/components/ui";
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
      className={button("primary", "mt-6 w-full py-3")}
    >
      Open in Jhola and change it
    </button>
  );
}
