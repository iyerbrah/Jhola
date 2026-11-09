/**
 * The numbers behind the public /stats page, all computed in SQL over the request log.
 * Days are India days (Asia/Kolkata). Percentiles use percentile_disc, the same nearest-rank method as
 * lib/percentile.ts and the evals. Only totals leave this file: no query text, no visitor IDs.
 */
import { getSql, ensureSchema, type Sql } from "./db";

export type DayStats = { day: string; builds: number; turns: number; visitors: number; cost_usd: number };
export type StepStats = { step: string; calls: number; avg_ms: number; p95_ms: number };

export type Stats = {
  days: number;
  totals: {
    requests: number;
    builds: number;
    /** Builds that called the model (not from the cache, not failed). */
    fresh_builds: number;
    turns: number;
    /** Average of each day's distinct visitors (visitor IDs change daily, so they can't be summed). */
    visitors_per_day: number;
    build_p50_ms: number | null;
    build_p95_ms: number | null;
    turn_p50_ms: number | null;
    turn_p95_ms: number | null;
    error_rate: number | null;
    give_up_rate: number | null;
    cache_hit_rate: number | null;
    repair_rate: number | null;
    cost_usd: number;
    cost_per_build: number | null;
    cost_per_turn: number | null;
  };
  feedback: { votes: number; up: number; on_carts: number; on_replies: number };
  daily: DayStats[];
  /** Average and p95 time of each kind of model call: plan, cart and repair for builds; one row for agent turns. */
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
      count(*) filter (where kind = 'build')::int                                            as builds,
      count(*) filter (where kind = 'build' and not cached and status <> 'error')::int       as fresh_builds,
      count(*) filter (where kind = 'agent')::int                                            as turns,
      percentile_disc(0.5)  within group (order by latency_ms) filter (where kind = 'build' and not cached and status <> 'error') as build_p50_ms,
      percentile_disc(0.95) within group (order by latency_ms) filter (where kind = 'build' and not cached and status <> 'error') as build_p95_ms,
      percentile_disc(0.5)  within group (order by latency_ms) filter (where kind = 'agent' and status <> 'error')                as turn_p50_ms,
      percentile_disc(0.95) within group (order by latency_ms) filter (where kind = 'agent' and status <> 'error')                as turn_p95_ms,
      (avg((status = 'error')::int))::float8                                                        as error_rate,
      (avg((status = 'gave_up')::int) filter (where kind = 'agent' and status <> 'error'))::float8  as give_up_rate,
      (avg(cached::int) filter (where kind = 'build' and status <> 'error'))::float8                 as cache_hit_rate,
      (avg(repaired::int) filter (where kind = 'build' and not cached and status <> 'error'))::float8 as repair_rate,
      coalesce(sum(cost_usd), 0)::float8                                                             as cost_usd,
      (avg(cost_usd) filter (where kind = 'build' and not cached and status <> 'error'))::float8     as cost_per_build,
      (avg(cost_usd) filter (where kind = 'agent' and status <> 'error'))::float8                    as cost_per_turn
    from requests
    where created_at >= ${since}`;

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
           coalesce(sum(r.cost_usd), 0)::float8               as cost_usd
    from d
    left join requests r on (r.created_at at time zone 'Asia/Kolkata')::date = d.day
    group by d.day
    order by d.day`;

  const [f] = await sql`
    select count(*)::int                                     as votes,
           count(*) filter (where rating = 1)::int           as up,
           count(*) filter (where target = 'cart')::int      as on_carts,
           count(*) filter (where target = 'reply')::int     as on_replies
    from feedback
    where created_at >= ${since}`;

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

  const days_with = daily.filter((d) => d.visitors > 0);
  return {
    days,
    totals: {
      requests: t.requests,
      builds: t.builds,
      fresh_builds: t.fresh_builds,
      turns: t.turns,
      visitors_per_day: days_with.length ? days_with.reduce((s, d) => s + d.visitors, 0) / days_with.length : 0,
      build_p50_ms: num(t.build_p50_ms),
      build_p95_ms: num(t.build_p95_ms),
      turn_p50_ms: num(t.turn_p50_ms),
      turn_p95_ms: num(t.turn_p95_ms),
      error_rate: num(t.error_rate),
      give_up_rate: num(t.give_up_rate),
      cache_hit_rate: num(t.cache_hit_rate),
      repair_rate: num(t.repair_rate),
      cost_usd: Number(t.cost_usd),
      cost_per_build: num(t.cost_per_build),
      cost_per_turn: num(t.cost_per_turn),
    },
    feedback: { votes: f.votes, up: f.up, on_carts: f.on_carts, on_replies: f.on_replies },
    daily: daily.map((d) => ({ day: d.day, builds: d.builds, turns: d.turns, visitors: d.visitors, cost_usd: Number(d.cost_usd) })),
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
