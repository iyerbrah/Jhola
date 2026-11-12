import type { DayStats } from "@/lib/stats";

/**
 * Requests per day: chat turns and old 3-cart builds stacked, one bar per day. Plain SVG rendered on the
 * server, so it ships no JavaScript. Each day has a hover target (its <title> is the tooltip) and a
 * table with the same numbers sits below the chart (the marigold is under 3:1 contrast on its own).
 * Colors were checked with the dataviz validator: indigo #5a6fd6 and marigold #c98500 stay distinct
 * for every kind of color blindness (ΔE 28.5).
 */
export const SERIES = [
  { key: "builds", label: "Old 3-cart builds", color: "#5a6fd6" },
  { key: "turns", label: "Chat turns", color: "#c98500" },
] as const;

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 34 };

const dayLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const label = (day: string) => dayLabel.format(new Date(`${day}T00:00:00Z`));

/** A tidy top for the y axis: 1, 2 or 5 times a power of ten, at or above the busiest day. */
function niceMax(n: number): number {
  if (n <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= n)!;
}

export function DailyChart({ daily }: { daily: DayStats[] }) {
  const max = niceMax(Math.max(...daily.map((d) => d.builds + d.turns), 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / daily.length;
  const barW = Math.max(3, Math.min(18, slot - 2)); // a 2px gap between bars
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const every = Math.ceil(daily.length / 6); // about six date labels

  return (
    <figure>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Chat turns (and old 3-cart builds) per day. The table below has the same numbers.">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-ink-soft)">
              {t}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const total = d.builds + d.turns;
          // Builds sit on the baseline, turns on top, with a 2px surface gap between them.
          const bTop = y(d.builds);
          const tTop = y(total);
          return (
            <g key={d.day} className="group">
              <title>{`${label(d.day)}: ${d.builds} old build${d.builds === 1 ? "" : "s"}, ${d.turns} chat turn${d.turns === 1 ? "" : "s"}, ${d.visitors} visitor${d.visitors === 1 ? "" : "s"}`}</title>
              {/* A hover target the full height of the plot, wider than the bar. */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" className="group-hover:fill-mist/60" />
              {d.builds > 0 && <rect x={x} y={bTop} width={barW} height={y(0) - bTop} rx={Math.min(4, barW / 2)} fill={SERIES[0].color} />}
              {d.turns > 0 && <rect x={x} y={tTop} width={barW} height={Math.max(1, bTop - tTop - (d.builds > 0 ? 2 : 0))} rx={Math.min(4, barW / 2)} fill={SERIES[1].color} />}
              {i % every === 0 && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-ink-soft)">
                  {label(d.day)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--color-ink-soft)" strokeWidth={1} />
      </svg>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-ink">Show as a table</summary>
        <table className="mt-2 w-full max-w-md text-left">
          <thead className="text-ink-soft">
            <tr>
              <th className="py-1 font-semibold">Day</th>
              <th className="py-1 text-right font-semibold">Cart builds</th>
              <th className="py-1 text-right font-semibold">Agent turns</th>
              <th className="py-1 text-right font-semibold">Visitors</th>
            </tr>
          </thead>
          <tbody className="num">
            {[...daily].reverse().map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="py-1">{label(d.day)}</td>
                <td className="py-1 text-right">{d.builds}</td>
                <td className="py-1 text-right">{d.turns}</td>
                <td className="py-1 text-right">{d.visitors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
