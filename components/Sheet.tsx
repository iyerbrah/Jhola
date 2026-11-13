"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = { open: boolean; onClose: () => void; title: string; children: ReactNode };

/** Bottom sheet on phones, centred dialog on wider screens. Esc and backdrop clicks close it. */
export function Sheet({ open, onClose, title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

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
      className="sheet-enter fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88vh] w-full max-w-none overflow-y-auto rounded-t-xl border-0 bg-paper p-0 text-ink sm:inset-0 sm:m-auto sm:max-w-lg sm:rounded-xl"
    >
      {open && (
        <>
          {/* A strip of the signboard: the sheet belongs to Jhola, not the page behind it. */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-sign px-5 py-3.5 text-on-sign shadow-[0_4px_0_var(--color-turmeric)]">
            <h2 className="font-sign text-2xl leading-tight">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="on-sign-focus -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-on-sign-soft hover:bg-sign-deep hover:text-on-sign"
              aria-label="Close"
            >
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
