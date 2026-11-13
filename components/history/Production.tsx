import { DailyChart } from "./DailyChart";
import { pct, secs } from "@/components/format";
import { CARD, H2, H3 } from "@/components/ui";
import type { Stats } from "@/lib/log/stats";

/** The live site's last 30 days, from the request log: requests per day, what went wrong, where the time goes. */
export function Production({ stats }: { stats: Stats }) {
  const t = stats.totals;
  return (
    <section aria-labelledby="prod" className="mt-14">
      <h2 id="prod" className={H2}>
        Running in production
      </h2>
      <p className="mt-2 text-ink-soft">The live site&apos;s last 30 days, from its request log, updated every minute.</p>
      <div className={`mt-6 ${CARD}`}>
        <h3 className={H3}>Requests per day</h3>
        <div className="mt-4">
          <DailyChart daily={stats.daily} />
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className={CARD}>
          <h3 className={H3}>What went wrong in real chats</h3>
          <dl className="mt-3 divide-y divide-line">
            <Row label="Turns whose cart failed a check" value={pct(stats.accuracy.failed_check_rate)} />
            <Row label="Turns that gave up (cart left as it was)" value={pct(t.give_up_rate)} />
            <Row label="Requests that failed" value={pct(t.error_rate)} />
            <Row label="Big changes held for the shopper's yes" value={pct(t.confirm_rate)} />
            <Row label="First messages answered from the cache" value={pct(t.turn_cache_rate)} />
          </dl>
        </div>
        {stats.steps.length > 0 && (
          <div className={CARD}>
            <h3 className={H3}>Where the time goes</h3>
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
                {stats.steps.map((x) => (
                  <tr key={x.step} className="border-t border-line">
                    <td className="py-1.5 text-ink">{x.step === "agent" ? "One agent model call" : `${x.step} (old 3-cart builder)`}</td>
                    <td className="py-1.5 text-right">{x.calls}</td>
                    <td className="py-1.5 text-right">{secs(x.avg_ms)}</td>
                    <td className="py-1.5 text-right">{secs(x.p95_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
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
