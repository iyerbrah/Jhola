/**
 * Runs: one shopper's chat from first message to "Looks good, I'm done" (or to leaving). A run is every
 * chat turn that carries the same session id, plus its order and rating, if any.
 *
 * What's public and what isn't is decided here, in one place. Everything measured about a run is public:
 * how it ended, its cost, time, tokens, calls and trace, its votes, and the name, stars and comment the
 * shopper chose to leave for the History page. What the shopper and the agent wrote (messages, replies,
 * the brief, the cart's products, the reasons a cart wasn't ready, error text) sits under `private` keys,
 * and publicRun() takes every one of them out. The History pages show `private` only after the admin key.
 */

export type OrderLine = { product_id: string; qty: number; price: number };

/** What "Looks good, I'm done" stores. */
export type OrderRecord = {
  id: string;
  number: string;
  session_id: string;
  request_id: string | null;
  visitor: string;
  total: number;
  items: number;
  lines: OrderLine[];
  /** The checklist's failures when it was ordered, in words. */
  failed: string[];
  /** Chat messages in the run before the order. */
  messages: number;
  created_at?: Date;
};

export type OrderRating = { order_id: string; stars: number; comment: string | null; name: string | null };

/** An order as the History pages see it. Public, except its lines and the failure text. */
export type OrderView = {
  number: string;
  at: string;
  total: number;
  items: number;
  messages: number;
  failed_checks: number;
  stars: number | null;
  comment: string | null;
  name: string | null;
  private?: { lines: (OrderLine & { name: string })[]; failed: string[] };
};

/** One row of the History list: all public. */
export type RunSummary = {
  session_id: string;
  started_at: string;
  last_at: string;
  turns: number;
  model_calls: number;
  tool_calls: number;
  /** Time spent answering, summed over the run's turns, and its slowest turn. */
  latency_ms: number;
  slowest_ms: number;
  cost_usd: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  /** Turns that code finished with no extra model call. */
  code_finished: number;
  gave_up: number;
  /** Was the cart ready to order after the last turn (lib/cart/ready.ts)? null when not judged. */
  ready: boolean | null;
  /** 👍 and 👎 on the run's replies. */
  up: number;
  down: number;
  order: OrderView | null;
};

export type StepView = {
  kind: "model" | "tool";
  name: string;
  ok: boolean;
  ms: number;
  input_tokens: number | null;
  cached_tokens: number | null;
  output_tokens: number | null;
  private?: { error: string | null };
};

export type CartLineView = { product_id: string; name: string; qty: number; price: number; included: boolean };

export type TurnView = {
  id: string;
  at: string;
  status: string;
  stop_reason: string | null;
  cached: boolean;
  finished_by: string | null;
  latency_ms: number;
  cost_usd: number | null;
  input_tokens: number | null;
  cached_tokens: number | null;
  output_tokens: number | null;
  model_calls: number | null;
  tool_calls: number | null;
  ready: boolean | null;
  failed_checks: number;
  up: number;
  down: number;
  /** The cart the turn left. */
  cart: { total: number; items: number } | null;
  steps: StepView[];
  private?: { message: string; reply: string; not_ready: string[]; lines: CartLineView[] };
};

export type RunDetail = {
  summary: RunSummary;
  turns: TurnView[];
  private?: { brief: string };
};

/** A copy without its `private` key. */
function omitPrivate<T extends { private?: unknown }>(x: T): Omit<T, "private"> {
  const copy = { ...x };
  delete copy.private;
  return copy;
}

/** A run with everything private taken out: what anyone may see. */
export function publicRun(run: RunDetail): RunDetail {
  return {
    summary: publicSummary(run.summary),
    turns: run.turns.map((t) => ({ ...omitPrivate(t), steps: t.steps.map(omitPrivate) })),
  };
}

export function publicSummary(s: RunSummary): RunSummary {
  return s.order ? { ...s, order: omitPrivate(s.order) } : s;
}

// ---------- The numbers at the top of History ----------

export type Headline = {
  runs: number;
  ordered: number;
  /** Runs that ended in "Looks good, I'm done", out of all runs: the primary success metric. */
  order_rate: number | null;
  /** Chat messages before "Looks good, I'm done", over ordered runs. Fewer is better. */
  messages_median: number | null;
  messages_mean: number | null;
  ratings: number;
  avg_stars: number | null;
  votes: number;
  up: number;
  turns: number;
  cost_usd: number;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** The success metrics over a list of runs (used when there's no database to ask). */
export function headlineOf(runs: RunSummary[]): Headline {
  const ordered = runs.filter((r) => r.order);
  const rated = ordered.filter((r) => r.order!.stars != null);
  const messages = ordered.map((r) => r.order!.messages);
  return {
    runs: runs.length,
    ordered: ordered.length,
    order_rate: runs.length ? ordered.length / runs.length : null,
    messages_median: median(messages),
    messages_mean: mean(messages),
    ratings: rated.length,
    avg_stars: mean(rated.map((r) => r.order!.stars!)),
    votes: runs.reduce((s, r) => s + r.up + r.down, 0),
    up: runs.reduce((s, r) => s + r.up, 0),
    turns: runs.reduce((s, r) => s + r.turns, 0),
    cost_usd: runs.reduce((s, r) => s + r.cost_usd, 0),
  };
}

// ---------- Filters on the History list ----------

export const FILTERS = [
  { key: "all", label: "All" },
  { key: "ordered", label: "Ordered" },
  { key: "not-ordered", label: "Not ordered" },
  { key: "low", label: "Rated 1–2" },
  { key: "feedback", label: "Has feedback" },
  { key: "problems", label: "Problems" },
  { key: "slow", label: "Slow" },
  { key: "costly", label: "Costly" },
] as const;
export type FilterKey = (typeof FILTERS)[number]["key"];

export function isFilter(v: unknown): v is FilterKey {
  return FILTERS.some((f) => f.key === v);
}

/**
 * The runs a filter keeps.
 * - problems: a turn gave up, the last cart wasn't ready, or a reply got a 👎.
 * - slow: its slowest turn is over the p95 of every run's slowest turn.
 * - costly: it cost more than twice the median run.
 */
export function filterRuns(runs: RunSummary[], key: FilterKey): RunSummary[] {
  switch (key) {
    case "ordered":
      return runs.filter((r) => r.order);
    case "not-ordered":
      return runs.filter((r) => !r.order);
    case "low":
      return runs.filter((r) => r.order?.stars != null && r.order.stars <= 2);
    case "feedback":
      return runs.filter((r) => r.order?.comment);
    case "problems":
      return runs.filter((r) => r.gave_up > 0 || r.ready === false || r.down > 0);
    case "slow": {
      const slow = [...runs].map((r) => r.slowest_ms).sort((a, b) => a - b);
      if (slow.length < 2) return [];
      const p95 = slow[Math.min(slow.length - 1, Math.ceil(slow.length * 0.95) - 1)];
      return runs.filter((r) => r.slowest_ms >= p95 && r.slowest_ms > 0);
    }
    case "costly": {
      const m = median(runs.filter((r) => r.turns).map((r) => r.cost_usd));
      return m ? runs.filter((r) => r.cost_usd > 2 * m) : [];
    }
    default:
      return runs;
  }
}

/** A session id as the logs store it: a UUID. Anything else can't be a run. */
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
