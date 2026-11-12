import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { rupees } from "@/components/format";
import { SiteFooter } from "@/components/SiteFooter";
import { catalog, catalogIndex } from "@/lib/catalog";
import { solveSession } from "@/lib/chat/loop";
import { defaultShareStore, SHARE_ID } from "@/lib/chat/share";
import { OpenInJhola } from "./OpenInJhola";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "A shared cart", description: "A cart someone built with Jhola.", robots: { index: false } };

/** A shared cart, solved again now: today's stock and prices, the same choices. */
export default async function SharedCart({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SHARE_ID.test(id)) notFound();
  const session = await defaultShareStore()
    .load(id)
    .catch(() => null);
  if (!session) notFound();
  const { cart, checks, session: solved } = solveSession(session, { products: catalog, index: catalogIndex });
  const lines = cart.lines.filter((l) => l.counted);

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="font-display text-3xl leading-none text-ink">
          Jhola
        </Link>
      </header>
      <main>
        <p className="text-ink-soft">A cart shared from Jhola</p>
        <h1 className="font-display text-4xl leading-tight">{solved.brief.summary || "A shared cart"}</h1>
        <p className="mt-2 text-sm text-leaf">{checks.filter((c) => c.status === "pass").map((c) => `✓ ${c.label}`).join(" · ")}</p>
        <article className="relative mt-8 rounded-3xl border-2 border-t-[6px] border-ink bg-paper p-5 shadow-lift" style={{ "--tier": "var(--color-marigold)", borderTopColor: "var(--color-marigold)" } as React.CSSProperties}>
          <span className="jhola-handle" aria-hidden />
          <ul className="divide-y divide-line">
            {lines.map((l) => (
              <li key={`${l.need_id}:${l.product.id}`} className="flex justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block font-semibold">{l.product.name}</span>
                  <span className="block text-sm text-ink-soft">
                    {l.packs} × {l.product.brand}, {l.product.pack_label}
                    {l.why ? <span className="text-leaf"> · {l.why}</span> : null}
                  </span>
                </span>
                <span className="num shrink-0 font-semibold">{rupees(l.line_total)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t-2 border-ink pt-3">
            <span className="font-semibold">
              Total for {lines.length} {lines.length === 1 ? "item" : "items"}
            </span>
            <span className="num font-display text-3xl text-leaf">{rupees(cart.total)}</span>
          </div>
        </article>
        <OpenInJhola session={solved} />
        <p className="mt-3 text-sm text-ink-soft">Prices and stock are as of now, so they can differ from when it was shared.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
