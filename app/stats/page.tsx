import type { Metadata } from "next";
import Link from "next/link";
import { DailyChart } from "@/components/DailyChart";
import { usd } from "@/components/format";
import { SiteFooter } from "@/components/SiteFooter";
import { SignHeadline, SiteHeader } from "@/components/SiteHeader";
import { button, H2, Notice, StatBoard } from "@/components/ui";
import { loadStats, type Stats } from "@/lib/stats";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Live stats",
  description: "How the live Jhola site is doing: volume, speed, reliability, cost and feedback over the last 30 days.",
};

const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const secs = (ms: number | null) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`);
const STEP_LABEL: Record<string, string> = { agent: "One agent model call", plan: "Plan (old 3-cart builder)", cart: "One cart (old 3-cart builder)", repair: "Repair (old 3-cart builder)" };

export default async function StatsPage() {
  let stats: Stats | null = null;
  let failed = false;
  try {
    stats = await loadStats();
  } catch (err) {
    console.error("[stats] couldn't read the request log:", err instanceof Error ? err.message : err);
    failed = true;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader current="stats">
        <SignHeadline title="How the live site is doing">
          <p>
            The last 30 days of jhola.ramiyer.tech, straight from its request log in Postgres, updated every minute. Only totals are shown: no requests, and no addresses (visitors are counted with a
            daily code that can&apos;t be traced back).
          </p>
        </SignHeadline>
      </SiteHeader>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        {failed ? (
          <Notice>The request log can&apos;t be reached right now. The site itself keeps working; check back in a minute.</Notice>
        ) : !stats ? (
          <Notice>These numbers come from the live site&apos;s database, which isn&apos;t connected here.</Notice>
        ) : stats.totals.requests === 0 ? (
          <Notice>
            No requests yet in the last 30 days.{" "}
            <Link href="/" className={button("quiet")}>
              Build a cart
            </Link>{" "}
            and they&apos;ll show up here.
          </Notice>
        ) : (
          <Body stats={stats} />
        )}

        <SiteFooter />
      </main>
    </div>
  );
}

function Body({ stats }: { stats: Stats }) {
  const t = stats.totals;
  const f = stats.feedback;
  return (
    <>
      <div className="mt-10">
        <StatBoard
          cols={6}
          items={[
            ["Chats", String(t.chats), `${t.turns} turns`],
            ["Visitors a day", t.visitors_per_day.toFixed(1), "on days with visits"],
            ["Turn, median", secs(t.turn_p50_ms), `p95 ${secs(t.turn_p95_ms)}`],
            ["Model calls a turn", t.model_calls_per_turn == null ? "–" : t.model_calls_per_turn.toFixed(1), "on average"],
            ["Ended by code", pct(t.code_finished_rate), "no model call to finish"],
            ["Thumbs up", f.votes ? pct(f.up / f.votes) : "–", `${f.votes} vote${f.votes === 1 ? "" : "s"}`],
          ]}
        />
      </div>

      <section className="mt-10 rounded-md border-2 border-sign bg-paper p-5 sm:p-6" aria-labelledby="per-day">
        <h2 id="per-day" className={H2}>
          Requests per day
        </h2>
        <p className="mt-1 text-sm text-ink-soft">India time. Hover a day for its numbers.</p>
        <div className="mt-4">
          <DailyChart daily={stats.daily} />
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border-2 border-line bg-paper p-5 sm:p-6" aria-labelledby="reliability">
          <h2 id="reliability" className={H2}>
            Reliability
          </h2>
          <dl className="mt-3 divide-y divide-line">
            <Row label="Requests that failed" value={pct(t.error_rate)} />
            <Row label="Turns that gave up (cart left as it was)" value={pct(t.give_up_rate)} />
            <Row label="Big changes held for the shopper to confirm" value={pct(t.confirm_rate)} />
            <Row label="First messages answered from the cache" value={pct(t.turn_cache_rate)} />
            {t.builds > 0 && <Row label="Old 3-cart builds that needed a repair call" value={pct(t.repair_rate)} />}
          </dl>
        </section>

        <section className="rounded-md border-2 border-line bg-paper p-5 sm:p-6" aria-labelledby="cost">
          <h2 id="cost" className={H2}>
            Cost
          </h2>
          <dl className="mt-3 divide-y divide-line">
            <Row label="Total, last 30 days" value={usd(t.cost_usd)} />
            <Row label="Per turn" value={usd(t.cost_per_turn)} />
            {t.builds > 0 && <Row label="Per old 3-cart build" value={usd(t.cost_per_build)} />}
          </dl>
          <p className="mt-2 text-sm text-ink-soft">gpt-5.4-mini list prices, with cached input at its lower rate. Answers from the cache cost nothing.</p>
        </section>
      </div>

      {stats.steps.length > 0 && (
        <section className="mt-6 rounded-md border-2 border-line bg-paper p-5 sm:p-6" aria-labelledby="steps">
          <h2 id="steps" className={H2}>
            Where the time goes
          </h2>
          <p className="mt-1 text-sm text-ink-soft">Each model call, from the request log&apos;s traces. A clean turn makes one: code checks the cart and writes the reply.</p>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-ink-soft">
              <tr>
                <th className="py-1.5 font-semibold">Model call</th>
                <th className="py-1.5 text-right font-semibold">Calls</th>
                <th className="py-1.5 text-right font-semibold">Average</th>
                <th className="py-1.5 text-right font-semibold">p95</th>
              </tr>
            </thead>
            <tbody className="num">
              {stats.steps.map((s) => (
                <tr key={s.step} className="border-t border-line">
                  <td className="py-1.5 text-ink">{STEP_LABEL[s.step] ?? s.step}</td>
                  <td className="py-1.5 text-right">{s.calls}</td>
                  <td className="py-1.5 text-right">{secs(s.avg_ms)}</td>
                  <td className="py-1.5 text-right">{secs(s.p95_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-ink">{label}</dt>
      <dd className="num font-semibold text-ink">{value}</dd>
    </div>
  );
}
