import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { rupees } from "@/components/format";
import { defaultHistory, type HistoryEntry } from "@/lib/history";
import { redisFromEnv } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jhola: generations", robots: { index: false } };

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

function usd(n: number | null): string {
  if (n == null) return "price unknown";
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
}

const STATUS_STYLE: Record<HistoryEntry["status"], string> = {
  ok: "bg-leaf-soft text-leaf",
  partial: "bg-marigold-soft text-marigold-text",
  cannot_fulfil: "bg-mist text-ink-soft",
};
const STATUS_LABEL: Record<HistoryEntry["status"], string> = { ok: "OK", partial: "Partial", cannot_fulfil: "No carts" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  // On the public site this page shows everyone's queries, so it needs HISTORY_KEY (?key=...).
  if (process.env.NODE_ENV === "production") {
    const { key } = await searchParams;
    if (!process.env.HISTORY_KEY || key !== process.env.HISTORY_KEY) notFound();
  }

  const entries = await defaultHistory(redisFromEnv()).list();
  const priced = entries.filter((e) => e.cost_usd != null);
  const totalCost = priced.reduce((s, e) => s + (e.cost_usd ?? 0), 0);
  const avgLatency = entries.length ? entries.reduce((s, e) => s + e.meta.latency_ms, 0) / entries.length : 0;
  const repaired = entries.filter((e) => e.meta.repaired).length;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="font-display text-3xl leading-none text-ink">
          Jhola
        </Link>
        <Link href="/" className="text-sm font-semibold underline underline-offset-4">
          Build carts
        </Link>
      </header>

      <h1 className="font-display text-4xl text-ink">Generations</h1>
      <p className="mt-1 text-ink-soft">Every set of carts the model built, newest first. Answers served from the cache cost nothing and aren&apos;t listed.</p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Generations" value={String(entries.length)} />
        <Stat label="Total cost" value={usd(totalCost)} />
        <Stat label="Average cost" value={priced.length ? usd(totalCost / priced.length) : "–"} />
        <Stat label="Average time" value={entries.length ? `${(avgLatency / 1000).toFixed(1)} s` : "–"} />
      </dl>
      {entries.length > 0 && (
        <p className="mt-2 text-sm text-ink-soft">
          {repaired} of {entries.length} needed a repair call. Costs use OpenAI&apos;s list prices, with cached input billed at its lower rate.
        </p>
      )}

      {entries.length === 0 ? (
        <p className="mt-10 text-lg">
          Nothing here yet. <Link href="/" className="font-semibold underline underline-offset-4">Build some carts</Link> and they&apos;ll show up here.
        </p>
      ) : (
        <ol className="mt-8 space-y-3">
          {entries.map((e) => (
            <li key={e.id}>
              <details className="group rounded-2xl border-2 border-line bg-paper open:border-ink">
                <summary className="cursor-pointer list-none p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="font-semibold text-ink">{e.query}</p>
                    <p className="num font-semibold text-ink">{usd(e.cost_usd)}</p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                    <time dateTime={e.at}>{when.format(new Date(e.at))}</time>
                    <span className="num">{(e.meta.latency_ms / 1000).toFixed(1)} s</span>
                    {e.meta.repaired && <span>repaired</span>}
                    {e.variants.length > 0 && <span className="num">{e.variants.map((v) => rupees(v.total)).join(", ")}</span>}
                  </div>
                </summary>
                <div className="border-t border-line px-4 pb-4 pt-3">
                  <p className="num text-sm text-ink-soft">
                    {e.meta.model}: {e.meta.input_tokens.toLocaleString("en-IN")} input tokens ({e.meta.cached_tokens.toLocaleString("en-IN")} cached),{" "}
                    {e.meta.output_tokens.toLocaleString("en-IN")} output tokens
                  </p>
                  {e.message && <p className="mt-2">{e.message}</p>}
                  {e.assumptions.length > 0 && <p className="mt-1 text-sm text-ink-soft">{e.assumptions.join(". ")}.</p>}
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {e.variants.map((v) => (
                      <section key={v.name} className="rounded-xl bg-chalk p-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <h2 className="font-display text-lg leading-tight">{v.name}</h2>
                          <span className="num font-semibold text-leaf">{rupees(v.total)}</span>
                        </div>
                        <ul className="mt-2 space-y-1 text-sm">
                          {v.items.map((it) => (
                            <li key={it.product_id} className={`flex justify-between gap-2 ${it.optional ? "text-ink-soft" : ""}`}>
                              <span className="min-w-0">
                                {it.qty} × {it.name}
                                {it.optional ? " (optional)" : ""}
                              </span>
                              <span className="num shrink-0">{rupees(it.line_total)}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border-2 border-ink bg-paper px-4 py-3">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="num font-display text-2xl leading-tight text-ink">{value}</dd>
    </div>
  );
}
