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

/** 42% ("–" when unknown). */
export function pct(x: number | null | undefined): string {
  return x == null ? "–" : `${Math.round(x * 100)}%`;
}

/** 1.4 s ("–" when unknown). */
export function secs(ms: number | null | undefined): string {
  return ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`;
}

/** ★★★★☆ for 4 of 5. */
export function starText(n: number): string {
  return "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

/** ₹0.82: a small cost in rupees, to the paisa. */
export function rupeesExact(n: number | null | undefined): string {
  return n == null ? "–" : `₹${n.toFixed(2)}`;
}

/** 12,400 tokens ("–" when unknown). */
export function count(n: number | null | undefined): string {
  return n == null ? "–" : inr.format(n);
}

// Dates and times are shown in India time, everywhere.
const IST = "Asia/Kolkata";
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: IST });
const dayTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: IST });
const clockFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: IST });

/** 13 Nov. Takes an ISO time, or a "YYYY-MM-DD" day (read as that day in India). */
export function day(at: string): string {
  return dayFmt.format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T12:00:00+05:30` : at));
}

/** 13 Nov, 6:42 pm */
export function dayTime(at: string): string {
  return dayTimeFmt.format(new Date(at));
}

/** 6:42:10 pm */
export function clock(at: string): string {
  return clockFmt.format(new Date(at));
}
