import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { rupees, usd } from "@/components/format";
import { SignHeadline, SiteHeader } from "@/components/SiteHeader";
import { button, StatBoard } from "@/components/ui";
import { defaultRequestLog, type HistoryEntry } from "@/lib/requestLog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recent chats", robots: { index: false } };

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const STATUS_STYLE: Record<string, string> = {
  done: "bg-sign-soft text-sign",
  confirm: "bg-turmeric-soft text-turmeric-text",
  gave_up: "bg-chilli-soft text-chilli",
};
const STATUS_LABEL: Record<string, string> = { done: "Done", confirm: "Asked to confirm", gave_up: "Gave up" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  // On the public site this page shows everyone's messages, so it needs HISTORY_KEY (?key=...).
  if (process.env.NODE_ENV === "production") {
    const { key } = await searchParams;
    if (!process.env.HISTORY_KEY || key !== process.env.HISTORY_KEY) notFound();
  }

  // The newest turns from the request log. If the database can't be reached, say so instead of failing.
  let entries: HistoryEntry[] = [];
  let unavailable = false;
  try {
    entries = await defaultRequestLog().recentTurns(300);
  } catch (err) {
    console.error("[history] couldn't read the request log:", err instanceof Error ? err.message : err);
    unavailable = true;
  }
  // Turns of one chat together, newest chat first.
  const chats = new Map<string, HistoryEntry[]>();
  for (const e of entries) chats.set(e.session_id ?? e.id, [...(chats.get(e.session_id ?? e.id) ?? []), e]);
  const priced = entries.filter((e) => e.cost_usd != null && !e.cached);
  const totalCost = priced.reduce((s, e) => s + (e.cost_usd ?? 0), 0);
  const fresh = entries.filter((e) => !e.cached);
  const avgLatency = fresh.length ? fresh.reduce((s, e) => s + e.latency_ms, 0) / fresh.length : 0;
  const byCode = fresh.filter((e) => e.finished_by === "code").length;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader current="history">
        <SignHeadline title="Recent chats">
          <p>The last 300 turns, grouped by chat, newest first. Phone numbers and emails are masked before anything is stored.</p>
        </SignHeadline>
      </SiteHeader>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-16 sm:px-6">
        {unavailable && (
          <p role="alert" className="mt-8 rounded-md border-l-[6px] border-chilli bg-chilli-soft px-4 py-3 text-ink">
            The request log can&apos;t be reached right now, so nothing is listed. The site itself keeps working.
          </p>
        )}

        <div className="mt-10">
          <StatBoard
            cols={4}
            items={[
              ["Chats", String(chats.size)],
              ["Turns", String(entries.length)],
              ["Cost", usd(totalCost)],
              ["Average turn", fresh.length ? `${(avgLatency / 1000).toFixed(1)} s` : "–"],
            ]}
          />
        </div>
        {fresh.length > 0 && (
          <p className="mt-4 text-sm text-ink-soft">
            {byCode} of {fresh.length} turns ended in code with no extra model call. Costs use gpt-5.4-mini&apos;s list prices, with cached input at its lower rate.
          </p>
        )}

        {unavailable ? null : entries.length === 0 ? (
          <p className="mt-10 text-lg">
            Nothing here yet.{" "}
            <Link href="/" className={button("quiet")}>
              Build a cart
            </Link>{" "}
            and it&apos;ll show up here.
          </p>
        ) : (
          <ol className="mt-8 space-y-3">
            {[...chats].map(([id, turns]) => {
              const first = turns.at(-1)!;
              const last = turns[0];
              return (
                <li key={id}>
                  <details className="group rounded-md border-2 border-line bg-paper open:border-sign">
                    <summary className="cursor-pointer list-none p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="font-semibold text-ink">{last.summary || first.message}</p>
                        <p className="num font-semibold text-ink">{last.total != null ? rupees(last.total) : "–"}</p>
                      </div>
                      <p className="mt-1 text-sm text-ink-soft">
                        <time dateTime={first.at}>{when.format(new Date(first.at))}</time>, {turns.length} turn{turns.length === 1 ? "" : "s"}, {usd(turns.reduce((s, t) => s + (t.cost_usd ?? 0), 0))}
                      </p>
                    </summary>
                    <ol className="space-y-3 border-t border-line px-4 pb-4 pt-3">
                      {[...turns].reverse().map((t) => (
                        <li key={t.id}>
                          <p className="font-semibold">{t.message}</p>
                          <p className="mt-0.5">{t.reply}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[t.status] ?? "bg-wall text-ink-soft"}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                            <span className="num">{t.cached ? "from the cache" : `${(t.latency_ms / 1000).toFixed(1)} s · ${t.model_calls ?? 0} model + ${t.tool_calls ?? 0} tool calls`}</span>
                            {t.total != null && (
                              <span className="num">
                                {t.items} items, {rupees(t.total)}
                              </span>
                            )}
                            <span className="num">{usd(t.cost_usd)}</span>
                          </p>
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}
