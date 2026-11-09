const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹1,234 (Indian digit grouping) */
export function rupees(n: number): string {
  return `₹${inr.format(n)}`;
}

/** Dollars at a precision that suits the size: $0, $0.0042, $0.021, $1.25. "–" when unknown. */
export function usd(n: number | null | undefined): string {
  if (n == null) return "–";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
