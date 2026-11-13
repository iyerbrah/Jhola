/**
 * Value at the given percentile (0-100), nearest-rank: the smallest value with at least p% of the
 * values at or below it. Postgres's percentile_disc gives the same answer, so the live numbers and the evals
 * report latency the same way.
 */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
