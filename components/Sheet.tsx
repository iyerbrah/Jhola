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
      className="sheet-enter fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85vh] w-full max-w-none overflow-y-auto rounded-t-3xl border-2 border-b-0 border-ink bg-paper p-0 text-ink sm:inset-0 sm:m-auto sm:max-w-lg sm:rounded-3xl sm:border-b-2"
    >
      {open && (
        <div className="p-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 className="font-display text-2xl leading-tight">{title}</h2>
            <button type="button" onClick={onClose} className="-mr-1 rounded-lg px-2 py-1 text-ink-soft hover:text-ink" aria-label="Close">
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
