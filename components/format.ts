const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹1,234 (Indian digit grouping) */
export function rupees(n: number): string {
  return `₹${inr.format(n)}`;
}
