import Link from "next/link";
import type { ReactNode } from "react";

export type Page = "home" | "results" | "how" | "history";

const NAV: { page: Page; href: string; label: string }[] = [
  { page: "history", href: "/history", label: "History" },
  { page: "results", href: "/results", label: "Results" },
  { page: "how", href: "/how-it-works", label: "How it works" },
];

type Props = {
  /** The page it sits on, marked in the nav. */
  current?: Page;
  /** The headline block for a tall sign; without it the sign is a compact bar. */
  children?: ReactNode;
  /** The app resets the cart from the wordmark instead of following a link. */
  onHome?: () => void;
};

/** The signboard: painted green, the Jhola wordmark, the site nav, and on tall signs the page's headline. */
export function SiteHeader({ current, children, onHome }: Props) {
  const mark = <span className="painted text-[2rem] leading-none sm:text-[2.25rem]">Jhola</span>;
  return (
    <div className="sign-band">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <header className="flex items-center justify-between gap-4 py-4">
          {onHome ? (
            <button type="button" onClick={onHome} aria-label="Jhola: start a new cart" className="rounded-md">
              {mark}
            </button>
          ) : (
            <Link href="/" aria-label="Jhola: build a cart" className="rounded-md">
              {mark}
            </Link>
          )}
          <nav aria-label="Site" className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-[15px] font-semibold">
            {NAV.map((n) => (
              <Link
                key={n.page}
                href={n.href}
                aria-current={current === n.page ? "page" : undefined}
                className={`underline-offset-[6px] hover:text-on-sign ${
                  current === n.page ? "text-on-sign underline decoration-turmeric decoration-[3px]" : "text-on-sign-soft hover:underline hover:decoration-on-sign-soft/60"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        {children}
      </div>
    </div>
  );
}

/** A tall sign's headline and the line under it. */
export function SignHeadline({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="pb-14 pt-8 sm:pb-16 sm:pt-12">
      <h1 className="painted max-w-4xl text-[2.75rem] leading-[1.02] sm:text-[4rem]">{title}</h1>
      {children && <div className="mt-5 max-w-2xl text-lg leading-relaxed text-on-sign-soft">{children}</div>}
    </div>
  );
}
