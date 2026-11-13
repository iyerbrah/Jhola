import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { rupees } from "@/components/format";
import { SiteFooter } from "@/components/SiteFooter";
import { SignHeadline, SiteHeader } from "@/components/SiteHeader";
import { PANEL, PriceTag } from "@/components/ui";
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

  const passed = checks.filter((c) => c.status === "pass");

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <SignHeadline title={solved.brief.summary || "A shared cart"}>
          <p>A cart shared from Jhola, solved again just now against today&apos;s stock and prices.</p>
        </SignHeadline>
      </SiteHeader>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 sm:px-6">
        <div className="max-w-2xl">
          <article aria-label="The shared cart" className={`${PANEL} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 bg-sign px-5 py-3.5 shadow-[0_4px_0_var(--color-turmeric)]">
              <h2 className="font-sign text-2xl leading-tight text-on-sign">The cart</h2>
              <PriceTag amount={cart.total} label="Total" />
            </div>
            {passed.length > 0 && (
              <ul aria-label="Checks" className="mx-5 mt-5 flex flex-wrap gap-x-3.5 gap-y-0.5 rounded-md bg-sign-soft px-3 py-2 text-sm text-sign">
                {passed.map((c) => (
                  <li key={c.id}>
                    <span aria-hidden>✓ </span>
                    {c.label}
                  </li>
                ))}
              </ul>
            )}
            <ul className="divide-y divide-line px-5">
              {lines.map((l) => (
                <li key={`${l.need_id}:${l.product.id}`} className="flex justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block font-semibold">{l.product.name}</span>
                    <span className="block text-sm text-ink-soft">
                      {l.packs} × {l.product.brand}, {l.product.pack_label}
                    </span>
                    {l.why ? <span className="mt-1 inline-block rounded-full bg-sign-soft px-2 py-0.5 text-xs font-semibold text-sign">{l.why}</span> : null}
                  </span>
                  <span className="num shrink-0 font-bold">{rupees(l.line_total)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between border-t-2 border-sign px-5 py-4">
              <span className="font-semibold">
                Total for {lines.length} {lines.length === 1 ? "item" : "items"}
              </span>
              <span className="num font-sign text-[2rem] leading-none">{rupees(cart.total)}</span>
            </div>
          </article>
          <OpenInJhola session={solved} />
          <p className="mt-3 text-sm text-ink-soft">Prices and stock are as of now, so they can differ from when it was shared.</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
