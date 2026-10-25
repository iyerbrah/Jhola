import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="hero-band">
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6">
          <Link href="/" className="font-display text-3xl leading-none text-on-ink">
            Jhola
          </Link>
          <h1 className="mt-16 max-w-2xl font-display text-5xl leading-[1.05] text-on-ink sm:text-6xl">This page isn&apos;t on the list.</h1>
          <p className="mt-4 max-w-lg text-lg text-on-ink-soft">The link may be old or mistyped.</p>
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Link
          href="/"
          className="relative z-10 -mt-7 inline-block rounded-xl border-2 border-ink bg-paper px-5 py-3 font-bold text-ink shadow-[5px_5px_0_var(--color-marigold)]"
        >
          Build some carts
        </Link>
        <SiteFooter />
      </div>
    </div>
  );
}
