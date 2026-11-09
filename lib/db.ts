/**
 * The Postgres connection and schema for Jhola's request log.
 *
 * Kept deliberately simple: no migration tool. SCHEMA only ever creates what's missing
 * ("create … if not exists", and later "alter table … add column if not exists"), and the app runs
 * it once per process before its first write or read. So a deploy that adds a column needs no extra
 * step. Rule: only add things; never rename or drop what the previous deploy still uses.
 *
 * Without DATABASE_URL (your own machine, tests) there's no connection and callers fall back.
 */
import postgres from "postgres";

export type Sql = postgres.Sql;

export const SCHEMA = `
create table if not exists requests (
  id            uuid primary key,
  kind          text not null check (kind in ('build', 'agent')),
  created_at    timestamptz not null default now(),
  parent_id     uuid,          -- an agent turn's build (no foreign key: that write may have been skipped)
  visitor       text not null, -- a daily, salted hash of the address: never the address itself
  query         text,
  status        text not null, -- ok | partial | cannot_fulfil | done | gave_up | error
  stop_reason   text,
  error_kind    text,
  cached        boolean not null default false,
  repaired      boolean,
  model         text,
  latency_ms    integer not null,
  input_tokens  integer,
  cached_tokens integer,
  output_tokens integer,
  cost_usd      numeric(10, 6),
  model_calls   smallint,
  tool_calls    smallint,
  catalog_size  integer,
  meta          jsonb not null default '{}'
);
create index if not exists requests_created_idx on requests (created_at desc);
create index if not exists requests_kind_created_idx on requests (kind, created_at desc);

create table if not exists carts (
  id         bigserial primary key,
  request_id uuid not null references requests (id) on delete cascade,
  role       text not null check (role in ('result', 'before', 'after')),
  position   smallint not null,
  name       text not null,
  reason     text not null default '',
  total      integer not null,
  unique (request_id, role, position)
);

create table if not exists cart_items (
  cart_id    bigint not null references carts (id) on delete cascade,
  line       smallint not null,
  product_id text not null,
  qty        smallint not null,
  price      integer not null,
  optional   boolean not null,
  included   boolean not null,
  note       text not null default '',
  primary key (cart_id, line)
);
create index if not exists cart_items_product_idx on cart_items (product_id);

create table if not exists trace_steps (
  request_id    uuid not null references requests (id) on delete cascade,
  step          smallint not null,
  kind          text not null check (kind in ('model', 'tool')),
  name          text not null,
  attempt       smallint not null default 1,
  ok            boolean not null,
  ms            integer not null,
  input_tokens  integer,
  cached_tokens integer,
  output_tokens integer,
  error         text,
  primary key (request_id, step)
);

create table if not exists feedback (
  id            bigserial primary key,
  request_id    uuid not null references requests (id) on delete cascade,
  target        text not null check (target in ('cart', 'reply')),
  cart_position smallint not null default -1, -- which of the build's carts; -1 for an agent reply
  rating        smallint not null check (rating in (-1, 1)),
  visitor       text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (request_id, target, cart_position, visitor)
);
`;

// Next gives each route its own copy of a module, so module-level variables aren't shared between
// routes. The pool lives on globalThis instead: one per server process.
const holder = globalThis as unknown as { __jholaSql?: Sql | null };

/** The shared connection pool, or null when DATABASE_URL isn't set. */
export function getSql(): Sql | null {
  if (holder.__jholaSql !== undefined) return holder.__jholaSql;
  const url = process.env.DATABASE_URL;
  holder.__jholaSql = url ? connect(url) : null;
  return holder.__jholaSql;
}

/** A small pool with short timeouts: a slow or missing database must never hold up a shopper. */
export function connect(url: string): Sql {
  return postgres(url, {
    max: 4,
    connect_timeout: 3,
    idle_timeout: 30,
    connection: { statement_timeout: 3000, application_name: "jhola" },
    onnotice: () => {}, // "relation already exists, skipping" on every start
    transform: { undefined: null }, // a field left out is stored as null
  });
}

const ready = new WeakMap<Sql, Promise<void>>();

/** Creates any missing tables, once per connection pool. A failure is retried on the next call. */
export function ensureSchema(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) {
    p = sql
      .unsafe(SCHEMA)
      .then(() => undefined)
      .catch((err) => {
        ready.delete(sql);
        throw err;
      });
    ready.set(sql, p);
  }
  return p;
}
