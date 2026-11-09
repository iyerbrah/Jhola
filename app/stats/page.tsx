import type { Metadata } from "next";
import Link from "next/link";
import { DailyChart } from "@/components/DailyChart";
import { SiteFooter } from "@/components/SiteFooter";
import { loadStats, type Stats } from "@/lib/stats";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Live stats",
  description: "How the live Jhola site is doing: volume, speed, reliability, cost and feedback over the last 30 days.",
};

const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const secs = (ms: number | null) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`);
const usd = (n: number | null) => (n == null ? "–" : n < 0.1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const STEP_LABEL: Record<string, string> = { plan: "Plan (cart builder)", cart: "One cart (cart builder)", repair: "Repair (cart builder)", agent: "One agent step" };

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
    <div className="mx-auto max-w-5xl px-4 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="font-display text-3xl leading-none text-ink">
          Jhola
        </Link>
        <Link href="/" className="text-sm font-semibold underline underline-offset-4">
          Build carts
        </Link>
      </header>

      <h1 className="font-display text-4xl text-ink sm:text-5xl">How the live site is doing</h1>
      <p className="mt-2 max-w-2xl text-lg text-ink-soft">
        The last 30 days of jhola.ramiyer.tech, straight from its request log in Postgres, updated every minute. Only totals are shown: no requests,
        and no addresses (visitors are counted with a daily code that can&apos;t be traced back).
      </p>

      {failed ? (
        <Notice>The request log can&apos;t be reached right now. The site itself keeps working; check back in a minute.</Notice>
      ) : !stats ? (
        <Notice>These numbers come from the live site&apos;s database, which isn&apos;t connected here.</Notice>
      ) : stats.totals.requests === 0 ? (
        <Notice>
          No requests yet in the last 30 days. <Link href="/" className="font-semibold underline underline-offset-4">Build some carts</Link> and
          they&apos;ll show up here.
        </Notice>
      ) : (
        <Body stats={stats} />
      )}

      <SiteFooter />
    </div>
  );
}

function Body({ stats }: { stats: Stats }) {
  const t = stats.totals;
  const f = stats.feedback;
  return (
    <>
      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Cart builds" value={String(t.builds)} note={`${t.fresh_builds} built fresh`} />
        <Tile label="Agent turns" value={String(t.turns)} note="changes made in chat" />
        <Tile label="Visitors a day" value={t.visitors_per_day.toFixed(1)} note="on days with visits" />
        <Tile label="Fresh build, median" value={secs(t.build_p50_ms)} note={`p95 ${secs(t.build_p95_ms)}`} />
        <Tile label="Agent turn, median" value={secs(t.turn_p50_ms)} note={`p95 ${secs(t.turn_p95_ms)}`} />
        <Tile label="Thumbs up" value={f.votes ? pct(f.up / f.votes) : "–"} note={`${f.votes} vote${f.votes === 1 ? "" : "s"}`} />
      </dl>

      <section className="mt-10 rounded-3xl border-2 border-ink bg-paper p-5 sm:p-6" aria-labelledby="per-day">
        <h2 id="per-day" className="font-display text-2xl">
          Requests per day
        </h2>
        <p className="mt-1 text-sm text-ink-soft">India time. Hover a day for its numbers.</p>
        <div className="mt-4">
          <DailyChart daily={stats.daily} />
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border-2 border-line bg-paper p-5 sm:p-6" aria-labelledby="reliability">
          <h2 id="reliability" className="font-display text-2xl">
            Reliability
          </h2>
          <dl className="mt-3 divide-y divide-line">
            <Row label="Requests that failed" value={pct(t.error_rate)} />
            <Row label="Agent turns that gave up (carts left as they were)" value={pct(t.give_up_rate)} />
            <Row label="Fresh builds that needed a repair call" value={pct(t.repair_rate)} />
            <Row label="Builds answered from the cache" value={pct(t.cache_hit_rate)} />
          </dl>
        </section>

        <section className="rounded-3xl border-2 border-line bg-paper p-5 sm:p-6" aria-labelledby="cost">
          <h2 id="cost" className="font-display text-2xl">
            Cost
          </h2>
          <dl className="mt-3 divide-y divide-line">
            <Row label="Total, last 30 days" value={usd(t.cost_usd)} />
            <Row label="Per fresh cart build" value={usd(t.cost_per_build)} />
            <Row label="Per agent turn" value={usd(t.cost_per_turn)} />
          </dl>
          <p className="mt-2 text-sm text-ink-soft">OpenAI list prices, with cached input at its lower rate. Answers from the cache cost nothing.</p>
        </section>
      </div>

      {stats.steps.length > 0 && (
        <section className="mt-6 rounded-3xl border-2 border-line bg-paper p-5 sm:p-6" aria-labelledby="steps">
          <h2 id="steps" className="font-display text-2xl">
            Where the time goes
          </h2>
          <p className="mt-1 text-sm text-ink-soft">Each model call, from the request log&apos;s traces. A cart build makes one plan call, then three cart calls at once.</p>
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

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border-2 border-ink bg-paper px-4 py-3">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="num font-display text-2xl leading-tight text-ink">{value}</dd>
      <dd className="text-xs text-ink-soft">{note}</dd>
    </div>
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

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mt-8 max-w-2xl rounded-2xl border-l-4 border-marigold bg-paper px-4 py-3 text-lg">{children}</p>;
}
