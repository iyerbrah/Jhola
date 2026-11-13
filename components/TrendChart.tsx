/**
 * Rates over time (0-100%): one line per series, one point per run or day. Plain SVG rendered on the server,
 * like DailyChart: each point has a hover target (its <title> is the tooltip), and a table with the same
 * numbers sits under the chart. The two colours differ in lightness as well as hue (sign green #0a5a32 and
 * rani #c8195a), and the second series is dashed, so they stay apart for every kind of colour blindness.
 */
export type TrendPoint = { label: string; title: string; values: Record<string, number | null> };
export type TrendSeries = { key: string; label: string };

const COLORS = ["#0a5a32", "#c8195a"];
const W = 720;
const H = 220;
const PAD = { top: 14, right: 14, bottom: 28, left: 40 };

export function TrendChart({ points, series, caption }: { points: TrendPoint[]; series: TrendSeries[]; caption: string }) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - v * plotH;
  const every = Math.max(1, Math.ceil(points.length / 6));

  return (
    <figure>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft" aria-hidden>
        {series.map((s, i) => (
          <span key={s.key} className="flex items-center gap-2">
            <svg width="22" height="8">
              <line x1="0" x2="22" y1="4" y2="4" stroke={COLORS[i % COLORS.length]} strokeWidth="3" strokeDasharray={i === 1 ? "5 3" : undefined} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${caption} The table below has the same numbers.`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-ink-soft)">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {series.map((s, si) => {
          const pts = points.map((p, i) => (p.values[s.key] == null ? null : ([x(i), y(p.values[s.key]!)] as const)));
          // A gap in the data breaks the line rather than joining across it.
          const segments: string[] = [];
          let current: string[] = [];
          for (const p of pts) {
            if (p) current.push(`${p[0]},${p[1]}`);
            else if (current.length) {
              segments.push(current.join(" "));
              current = [];
            }
          }
          if (current.length) segments.push(current.join(" "));
          const color = COLORS[si % COLORS.length];
          return (
            <g key={s.key}>
              {segments.map((seg, k) => (
                <polyline key={k} points={seg} fill="none" stroke={color} strokeWidth={3} strokeDasharray={si === 1 ? "6 4" : undefined} strokeLinejoin="round" />
              ))}
              {pts.map((p, i) => (p ? <circle key={i} cx={p[0]} cy={p[1]} r={4} fill={color} /> : null))}
            </g>
          );
        })}
        {points.map((p, i) => (
          <g key={i} className="group">
            <title>{p.title}</title>
            <rect x={x(i) - Math.max(8, plotW / Math.max(1, points.length) / 2)} y={PAD.top} width={Math.max(16, plotW / Math.max(1, points.length))} height={plotH} fill="transparent" className="group-hover:fill-sign-soft/50" />
            {i % every === 0 && (
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-ink-soft)">
                {p.label}
              </text>
            )}
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--color-ink-soft)" strokeWidth={1} />
      </svg>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-rani">Show as a table</summary>
        <table className="mt-2 w-full max-w-xl text-left">
          <thead className="text-ink-soft">
            <tr>
              <th className="py-1 font-semibold">When</th>
              {series.map((s) => (
                <th key={s.key} className="py-1 text-right font-semibold">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {[...points].reverse().map((p, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{p.label}</td>
                {series.map((s) => (
                  <td key={s.key} className="py-1 text-right">
                    {p.values[s.key] == null ? "–" : `${Math.round(p.values[s.key]! * 100)}%`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
