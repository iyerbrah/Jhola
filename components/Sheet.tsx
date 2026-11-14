"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Words beside the close cross, where "Close" alone doesn't say where it goes: "Back to chat". */
  closeLabel?: string;
};

/** Bottom sheet on phones, centred dialog on wider screens. Esc, a backdrop tap, the cross, or (on phones) a swipe down on its sign closes it. */
export function Sheet({ open, onClose, title, children, closeLabel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
      style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
      className="sheet-enter fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88vh] w-full max-w-none overflow-y-auto rounded-t-xl border-0 bg-paper p-0 text-ink sm:inset-0 sm:m-auto sm:max-w-lg sm:rounded-xl"
    >
      {open && (
        <>
          {/* A strip of the signboard: the sheet belongs to Jhola, not the page behind it. */}
          <div
            className="sticky top-0 z-10 flex touch-none items-center justify-between gap-4 bg-sign px-5 pb-3.5 pt-5 text-on-sign shadow-[0_4px_0_var(--color-turmeric)] sm:touch-auto sm:pt-3.5"
            onTouchStart={(e) => (start.current = e.touches[0].clientY)}
            onTouchMove={(e) => start.current != null && setDrag(Math.max(0, e.touches[0].clientY - start.current))}
            onTouchEnd={() => {
              if (drag > 80) onClose();
              start.current = null;
              setDrag(0);
            }}
          >
            {/* The handle: this sheet can be pulled down to close. Phones only. */}
            <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-on-sign-soft sm:hidden" />
            <h2 className="font-sign text-2xl leading-tight">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className={`on-sign-focus -mr-1 flex h-9 shrink-0 items-center justify-center gap-2 rounded-md text-on-sign-soft hover:bg-sign-deep hover:text-on-sign ${closeLabel ? "px-2.5 text-sm font-semibold" : "w-9"}`}
              aria-label={closeLabel ?? "Close"}
            >
              {closeLabel && <span aria-hidden>{closeLabel}</span>}
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="px-5 pb-6 pt-5">{children}</div>
        </>
      )}
    </dialog>
  );
}
