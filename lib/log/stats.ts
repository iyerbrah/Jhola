/**
 * The live numbers behind the public /results page, all computed in SQL over the request log.
 * Days are India days (Asia/Kolkata). Percentiles use percentile_disc, the same nearest-rank method as
 * lib/percentile.ts and the evals. Only totals leave this file: no query text, no visitor IDs.
 */
import { getSql, ensureSchema, type Sql } from "./db";
import type { Headline } from "./runs";

export type DayStats = {
  day: string;
  builds: number;
  turns: number;
  visitors: number;
  cost_usd: number;
  /** Chats whose last turn was on this day and was judged, and the share of them that ended ready to order. */
  judged_chats: number;
  ready_rate: number | null;
  /** Thumbs up and down given on this day. */
  votes: number;
  up: number;
  /** Runs active on this day, and orders placed on it. */
  runs: number;
  orders: number;
};

/** Accuracy in production: every chat turn is judged like the eval judges a chat (lib/cart/ready.ts). */
export type LiveAccuracy = {
  /** Chats whose last turn was judged, and the share of them that ended with a cart ready to order. */
  judged_chats: number;
  ready_rate: number | null;
  /** The share of judged turns whose cart failed a check (diet, allergy, rule, budget, stock, price). */
  failed_check_rate: number | null;
  /** The first turn ever judged: turns from before then weren't, so they don't count. */
  tracked_since: string | null;
};
export type StepStats = { step: string; calls: number; avg_ms: number; p95_ms: number };

export type Stats = {
  days: number;
  totals: {
    /** Every request in the window, old 3-cart builds included. */
    requests: number;
    /** Chat turns, and how long the ones that didn't fail took. */
    turns: number;
    turn_p50_ms: number | null;
    turn_p95_ms: number | null;
    /** Failed requests, out of all; turns that gave up, out of chat turns that didn't fail. */
    error_rate: number | null;
    give_up_rate: number | null;
    cost_usd: number;
    cost_per_turn: number | null;
    /** How chat turns went: ended by code with no extra model call, held for a yes, answered from the cache. */
    code_finished_rate: number | null;
    confirm_rate: number | null;
    turn_cache_rate: number | null;
  };
  /** Thumbs up and down on replies (and, from before, on carts). */
  feedback: { votes: number; up: number };
  /** The success metrics: runs that ended in "Looks good, I'm done", the messages it took, and the stars. */
  success: Headline;
  accuracy: LiveAccuracy;
  daily: DayStats[];
  /** Average and p95 time of each kind of model call: one row for agent turns, plus plan, cart and repair for older builds. */
  steps: StepStats[];
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export async function queryStats(sql: Sql, days = 30): Promise<Stats> {
  await ensureSchema(sql);
  // The window starts at midnight in India, (days - 1) days ago: "the last 30 days" including today.
  const since = sql`((date_trunc('day', now() at time zone 'Asia/Kolkata') - make_interval(days => ${days - 1})) at time zone 'Asia/Kolkata')`;

  const [t] = await sql`
    select
      count(*)::int                                                                          as requests,
      count(*) filter (where kind = 'agent')::int                                            as turns,
      percentile_disc(0.5)  within group (order by latency_ms) filter (where kind = 'agent' and status <> 'error')                as turn_p50_ms,
      percentile_disc(0.95) within group (order by latency_ms) filter (where kind = 'agent' and status <> 'error')                as turn_p95_ms,
      (avg((status = 'error')::int))::float8                                                        as error_rate,
      (avg((status = 'gave_up')::int) filter (where kind = 'agent' and status <> 'error'))::float8  as give_up_rate,
      coalesce(sum(cost_usd), 0)::float8                                                             as cost_usd,
      (avg(cost_usd) filter (where kind = 'agent' and status <> 'error'))::float8                    as cost_per_turn,
      (avg((meta ->> 'finished_by' = 'code')::int) filter (where kind = 'agent' and meta ->> 'chat' = 'true' and status in ('done', 'confirm') and not cached))::float8 as code_finished_rate,
      (avg((status = 'confirm')::int) filter (where kind = 'agent' and meta ->> 'chat' = 'true' and status <> 'error'))::float8 as confirm_rate,
      (avg(cached::int) filter (where kind = 'agent' and meta ->> 'chat' = 'true' and status <> 'error'))::float8 as turn_cache_rate
    from requests
    where created_at >= ${since}`;

  // Each judged chat once, by its last turn in the window (a chat can span days: it counts on its last one).
  const lastTurns = sql`
    select distinct on (meta ->> 'session_id') meta ->> 'session_id' as session_id, created_at, (meta ->> 'ready')::boolean as ready
    from requests
    where kind = 'agent' and meta ->> 'chat' = 'true' and meta ? 'ready' and status <> 'error' and created_at >= ${since}
    order by meta ->> 'session_id', created_at desc`;
  const [a] = await sql`
    select (select count(*)::int from (${lastTurns}) l)                                     as judged_chats,
           (select avg(ready::int)::float8 from (${lastTurns}) l)                          as ready_rate,
           (select avg(((meta ->> 'failed_checks')::int > 0)::int)::float8 from requests
             where kind = 'agent' and meta ? 'ready' and status <> 'error' and created_at >= ${since}) as failed_check_rate,
           (select to_char(min(created_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD') from requests where kind = 'agent' and meta ? 'ready') as tracked_since`;

  // Every day in the window, including days with nothing, so the chart has no gaps.
  const daily = await sql`
    with d as (
      select generate_series(
        (date_trunc('day', now() at time zone 'Asia/Kolkata') - make_interval(days => ${days - 1}))::date,
        (now() at time zone 'Asia/Kolkata')::date,
        interval '1 day'
      )::date as day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
           count(r.id) filter (where r.kind = 'build')::int as builds,
           count(r.id) filter (where r.kind = 'agent')::int as turns,
           count(distinct r.visitor)::int                     as visitors,
           coalesce(sum(r.cost_usd), 0)::float8               as cost_usd,
           (select count(*)::int from (${lastTurns}) l where (l.created_at at time zone 'Asia/Kolkata')::date = d.day)        as judged_chats,
           (select avg(l.ready::int)::float8 from (${lastTurns}) l where (l.created_at at time zone 'Asia/Kolkata')::date = d.day) as ready_rate,
           (select count(*)::int from feedback f where (f.created_at at time zone 'Asia/Kolkata')::date = d.day)                as votes,
           (select count(*)::int from feedback f where f.rating = 1 and (f.created_at at time zone 'Asia/Kolkata')::date = d.day) as up
    from d
    left join requests r on (r.created_at at time zone 'Asia/Kolkata')::date = d.day
    group by d.day
    order by d.day`;

  const [f] = await sql`
    select count(*)::int                                     as votes,
           count(*) filter (where rating = 1)::int           as up
    from feedback
    where created_at >= ${since}`;

  // A run is a chat (its turns share a session id) or an order without a logged chat; it counts if active in the window.
  const runIds = sql`
    select meta ->> 'session_id' as sid from requests
    where kind = 'agent' and meta ->> 'chat' = 'true' and status <> 'error' and meta ? 'session_id' and created_at >= ${since}
    union
    select session_id::text from orders where created_at >= ${since}`;
  // Each ordered run once, by its latest order.
  const lastOrders = sql`select distinct on (session_id) * from orders where created_at >= ${since} order by session_id, created_at desc`;
  const [o] = await sql`
    select (select count(*)::int from (${runIds}) r)                                         as runs,
           (select count(*)::int from (${lastOrders}) o)                                     as ordered,
           (select percentile_cont(0.5) within group (order by messages)::float8 from (${lastOrders}) o) as messages_median,
           (select avg(messages)::float8 from (${lastOrders}) o)                             as messages_mean,
           (select count(stars)::int from (${lastOrders}) o)                                 as ratings,
           (select avg(stars)::float8 from (${lastOrders}) o)                                as avg_stars,
           (select count(*)::int from feedback where target = 'reply' and created_at >= ${since}) as votes,
           (select count(*)::int from feedback where target = 'reply' and rating = 1 and created_at >= ${since}) as up`;
  const runDays = await sql`
    select to_char((created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day, count(distinct sid)::int as runs
    from (
      select meta ->> 'session_id' as sid, created_at from requests
      where kind = 'agent' and meta ->> 'chat' = 'true' and status <> 'error' and meta ? 'session_id' and created_at >= ${since}
      union all
      select session_id::text, created_at from orders where created_at >= ${since}
    ) x
    group by 1`;
  const orderDays = await sql`
    select to_char((created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day, count(*)::int as orders
    from orders where created_at >= ${since} group by 1`;
  const runsOn = new Map(runDays.map((d) => [d.day as string, d.runs as number]));
  const ordersOn = new Map(orderDays.map((d) => [d.day as string, d.orders as number]));

  const steps = await sql`
    select case when r.kind = 'agent' then 'agent' else split_part(s.name, ':', 1) end as step,
           count(*)::int                                                              as calls,
           round(avg(s.ms))::int                                                      as avg_ms,
           percentile_disc(0.95) within group (order by s.ms)                         as p95_ms
    from trace_steps s
    join requests r on r.id = s.request_id
    where s.kind = 'model' and s.ok and r.created_at >= ${since}
    group by 1
    order by array_position(array['plan', 'cart', 'repair', 'agent'], case when r.kind = 'agent' then 'agent' else split_part(s.name, ':', 1) end)`;

  return {
    days,
    totals: {
      requests: t.requests,
      turns: t.turns,
      turn_p50_ms: num(t.turn_p50_ms),
      turn_p95_ms: num(t.turn_p95_ms),
      error_rate: num(t.error_rate),
      give_up_rate: num(t.give_up_rate),
      cost_usd: Number(t.cost_usd),
      cost_per_turn: num(t.cost_per_turn),
      code_finished_rate: num(t.code_finished_rate),
      confirm_rate: num(t.confirm_rate),
      turn_cache_rate: num(t.turn_cache_rate),
    },
    feedback: { votes: f.votes, up: f.up },
    success: {
      runs: o.runs,
      ordered: o.ordered,
      order_rate: o.runs ? o.ordered / o.runs : null,
      messages_median: num(o.messages_median),
      messages_mean: num(o.messages_mean),
      ratings: o.ratings,
      avg_stars: num(o.avg_stars),
      votes: o.votes,
      up: o.up,
      turns: t.turns,
      cost_usd: Number(t.cost_usd),
    },
    accuracy: { judged_chats: a.judged_chats, ready_rate: num(a.ready_rate), failed_check_rate: num(a.failed_check_rate), tracked_since: a.tracked_since ?? null },
    daily: daily.map((d) => ({
      day: d.day,
      builds: d.builds,
      turns: d.turns,
      visitors: d.visitors,
      cost_usd: Number(d.cost_usd),
      judged_chats: d.judged_chats,
      ready_rate: num(d.ready_rate),
      votes: d.votes,
      up: d.up,
      runs: runsOn.get(d.day) ?? 0,
      orders: ordersOn.get(d.day) ?? 0,
    })),
    steps: steps.map((s) => ({ step: s.step, calls: s.calls, avg_ms: s.avg_ms, p95_ms: Number(s.p95_ms) })),
  };
}

// The page asks at most once a minute, whoever is looking at it (one copy per server process).
const memo = globalThis as unknown as { __jholaStats?: { at: number; stats: Stats } };

/** The site's stats, at most a minute old, or null when there's no database (your own machine). */
export async function loadStats(): Promise<Stats | null> {
  const sql = getSql();
  if (!sql) return null;
  if (memo.__jholaStats && Date.now() - memo.__jholaStats.at < 60_000) return memo.__jholaStats.stats;
  const stats = await queryStats(sql);
  memo.__jholaStats = { at: Date.now(), stats };
  return stats;
}
