import type { Metadata } from "next";
import Link from "next/link";
import { dayTime, pct, secs, starText, usd } from "@/components/format";
import { Production } from "@/components/history/Production";
import { OutcomeTag } from "@/components/history/OutcomeTag";
import { SiteFooter } from "@/components/SiteFooter";
import { SignHeadline, SiteHeader } from "@/components/SiteHeader";
import { button, chip, H2, Notice, StatBoard } from "@/components/ui";
import { defaultRequestLog } from "@/lib/log/requestLog";
import { FILTERS, filterRuns, headlineOf, isFilter, publicSummary, type Headline, type RunSummary } from "@/lib/log/runs";
import { loadStats, type Stats } from "@/lib/log/stats";
import { isUnlocked } from "./access";
import { ExportButton } from "../../components/history/ExportButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "History",
  description: "Every chat people have had with Jhola, the AI shopping agent: how it ended, what they said about it, what it cost and how long it took.",
  robots: { index: false },
};

const LIST = 300;
const one = (x: number | null) => (x == null ? "–" : String(Math.round(x * 10) / 10));

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const filter = isFilter(show) ? show : "all";

  // Runs from the request log, and the 30-day numbers from the database. Either can be down: say so, don't fail.
  let runs: RunSummary[] = [];
  let runsDown = false;
  let stats: Stats | null = null;
  try {
    runs = (await defaultRequestLog().recentRuns(LIST)).map(publicSummary);
  } catch (err) {
    console.error("[history] couldn't read the runs:", err instanceof Error ? err.message : err);
    runsDown = true;
  }
  try {
    stats = await loadStats();
  } catch (err) {
    console.error("[history] couldn't read the stats:", err instanceof Error ? err.message : err);
  }
  const unlocked = await isUnlocked();

  // With a database, the top numbers cover the last 30 days; without one (your own machine), the runs listed.
  const head: Headline = stats?.success ?? headlineOf(runs);
  const window = stats ? "last 30 days" : `the ${runs.length} newest runs`;
  const t = stats?.totals;
  const shown = filterRuns(runs, filter);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader current="history">
        <SignHeadline title="History">
          <p>
            Every chat on this site, from the first message to &ldquo;Looks good, I&apos;m done&rdquo;: how it ended, what the shopper said, what it cost and how long it took. Open a run to see
            every step.
          </p>
        </SignHeadline>
      </SiteHeader>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 sm:px-6">
        <section aria-labelledby="success">
          <h2 id="success" className={H2}>
            Did shoppers get their cart?
          </h2>
          <p className="mt-2 text-ink-soft">A run counts as a success when the shopper presses &ldquo;Looks good, I&apos;m done&rdquo;. From {window}.</p>
          <div className="mt-5">
            <StatBoard
              cols={3}
              items={[
                ["Runs that ended in an order", pct(head.order_rate), `${head.ordered} of ${head.runs} runs`],
                ["Messages to order", one(head.messages_median), head.messages_mean == null ? "median, over ordered runs" : `median; average ${one(head.messages_mean)}`],
                ["Average rating", head.avg_stars == null ? "–" : `★ ${head.avg_stars.toFixed(1)}`, `from ${head.ratings} rating${head.ratings === 1 ? "" : "s"}`],
              ]}
            />
          </div>
        </section>

        <section aria-labelledby="runs" className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="runs" className={H2}>
                Runs
              </h2>
              <p className="mt-2 max-w-2xl text-ink-soft">
                The {LIST} newest first. Names, stars and comments are public, with phone numbers, emails and links removed. Chat messages stay private.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ExportButton unlocked={unlocked} />
            </div>
          </div>

          <nav aria-label="Show runs" className="mt-5 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={f.key === "all" ? "/history" : `/history?show=${f.key}`}
                aria-current={filter === f.key ? "page" : undefined}
                className={chip(filter === f.key ? "selected" : "suggest")}
                scroll={false}
              >
                {f.label}
                {f.key !== "all" && <span className="num text-ink-soft">{filterRuns(runs, f.key).length}</span>}
              </Link>
            ))}
          </nav>

          {runsDown ? (
            <Notice tone="warn">The request log can&apos;t be reached right now, so no runs are listed. The site itself keeps working.</Notice>
          ) : runs.length === 0 ? (
            <p className="mt-8 text-lg">
              No runs yet.{" "}
              <Link href="/" className={button("quiet")}>
                Build a cart
              </Link>{" "}
              and yours will be the first.
            </p>
          ) : shown.length === 0 ? (
            <p className="mt-8 text-lg text-ink-soft">No runs match this filter yet.</p>
          ) : (
            <RunTable runs={shown} />
          )}
        </section>

        <section aria-labelledby="more" className="mt-14">
          <h2 id="more" className={H2}>
            More numbers
          </h2>
          <p className="mt-2 text-ink-soft">How much work each run took, from {window}.</p>
          <div className="mt-5">
            <StatBoard
              cols={6}
              items={[
                ["Runs", String(head.runs)],
                ["Turns", String(t?.turns ?? head.turns)],
                ["Helpful replies", head.votes ? pct(head.up / head.votes) : "–", `${head.votes} vote${head.votes === 1 ? "" : "s"}`],
                ["Turn, median", t ? secs(t.turn_p50_ms) : "–", t ? `p95 ${secs(t.turn_p95_ms)}` : undefined],
                ["Ended by code", t ? pct(t.code_finished_rate) : "–", "no model call to finish"],
                [
                  "Cost per order",
                  head.ordered ? usd(head.cost_usd / head.ordered) : "–",
                  t?.cost_per_turn != null ? `${usd(t.cost_per_turn)} a turn` : head.turns ? `${usd(head.cost_usd / head.turns)} a turn` : undefined,
                ],
              ]}
            />
          </div>
        </section>

        {stats && stats.totals.requests > 0 ? <Production stats={stats} /> : !stats && <Notice>Charts of the last 30 days come from the site&apos;s database, which isn&apos;t connected here.</Notice>}
      </main>
      <SiteFooter />
    </div>
  );
}

function Stars({ n }: { n: number | null | undefined }) {
  if (n == null) return <span className="text-ink-soft">–</span>;
  return (
    <span className="whitespace-nowrap text-turmeric-text" role="img" aria-label={`${n} of 5 stars`}>
      {starText(n)}
    </span>
  );
}

/** One row per run, each opening the run. A table on wide screens, a list of rows on phones. */
function RunTable({ runs }: { runs: RunSummary[] }) {
  const href = (r: RunSummary) => `/history/${r.session_id}`;
  return (
    <>
      <table className="mt-6 hidden w-full border-collapse text-left md:table">
        <thead className="text-sm text-ink-soft">
          <tr className="border-b-[3px] border-sign">
            <th className="py-2 pr-3 font-semibold">When</th>
            <th className="py-2 pr-3 font-semibold">Who</th>
            <th className="py-2 pr-3 font-semibold">Outcome</th>
            <th className="py-2 pr-3 font-semibold">Rating</th>
            <th className="py-2 pr-3 font-semibold">Feedback</th>
            <th className="py-2 pr-3 text-right font-semibold">Turns</th>
            <th className="py-2 pr-3 text-right font-semibold">Calls</th>
            <th className="py-2 pr-3 text-right font-semibold">Time</th>
            <th className="py-2 text-right font-semibold">Cost</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.session_id} className="relative border-b border-line align-top hover:bg-paper">
              <td className="py-3 pr-3 text-sm whitespace-nowrap">
                <Link href={href(r)} className={button("quiet", "after:absolute after:inset-0")}>
                  <time dateTime={r.started_at}>{dayTime(r.started_at)}</time>
                </Link>
              </td>
              <td className={`py-3 pr-3 ${r.order?.name ? "font-semibold text-ink" : "text-ink-soft"}`}>{r.order?.name ?? "Anonymous"}</td>
              <td className="py-3 pr-3">
                <OutcomeTag run={r} />
              </td>
              <td className="py-3 pr-3">
                <Stars n={r.order?.stars} />
              </td>
              <td className="max-w-[18rem] py-3 pr-3 text-sm text-ink">
                <span className="line-clamp-2">{r.order?.comment ?? <span className="text-ink-soft">–</span>}</span>
              </td>
              <td className="num py-3 pr-3 text-right">{r.turns}</td>
              <td className="num py-3 pr-3 text-right whitespace-nowrap">
                {r.model_calls} + {r.tool_calls}
              </td>
              <td className="num py-3 pr-3 text-right whitespace-nowrap">{secs(r.latency_ms)}</td>
              <td className="num py-3 text-right whitespace-nowrap">{usd(r.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ol className="mt-6 divide-y divide-line border-y border-line md:hidden">
        {runs.map((r) => (
          <li key={r.session_id}>
            <Link href={href(r)} className="block py-3 hover:bg-paper">
              <span className="flex items-baseline justify-between gap-3">
                <span className={r.order?.name ? "font-semibold text-ink" : "text-ink-soft"}>{r.order?.name ?? "Anonymous"}</span>
                <time dateTime={r.started_at} className="text-sm text-ink-soft">
                  {dayTime(r.started_at)}
                </time>
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <OutcomeTag run={r} />
                <Stars n={r.order?.stars} />
              </span>
              {r.order?.comment && <span className="mt-1.5 line-clamp-2 block text-sm text-ink">{r.order.comment}</span>}
              <span className="num mt-1.5 flex flex-wrap gap-x-3 text-sm text-ink-soft">
                <span>
                  {r.turns} turn{r.turns === 1 ? "" : "s"}
                </span>
                <span>
                  {r.model_calls} model + {r.tool_calls} tool calls
                </span>
                <span>{secs(r.latency_ms)}</span>
                <span>{usd(r.cost_usd)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
