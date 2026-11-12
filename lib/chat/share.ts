/**
 * Shared carts: a snapshot of a session behind a short link (/c/<id>). Postgres when DATABASE_URL is
 * set, memory otherwise. A snapshot is immutable; opening it in Jhola starts a new chat from it.
 */
import { randomBytes } from "node:crypto";
import { ensureSchema, getSql, type Sql } from "../db";
import { maskPii } from "../requestLog";
import { SessionSchema, type Session } from "../cart/types";

export interface ShareStore {
  save(session: Session): Promise<string>;
  load(id: string): Promise<Session | null>;
}

/** 10 url-safe characters: about 60 bits, not guessable. */
export function newShareId(): string {
  return randomBytes(8).toString("base64url").slice(0, 10);
}
export const SHARE_ID = /^[A-Za-z0-9_-]{10}$/;

/** Takes the shopper's own words out of what a link shows to anyone who has it. */
function clean(s: Session): Session {
  return { ...s, brief: { ...s.brief, summary: maskPii(s.brief.summary), assumptions: s.brief.assumptions.map(maskPii) } };
}

export function createMemoryShareStore(): ShareStore {
  const m = new Map<string, Session>();
  return {
    async save(session) {
      const id = newShareId();
      m.set(id, clean(session));
      return id;
    },
    async load(id) {
      return m.get(id) ?? null;
    },
  };
}

export function createPgShareStore(sql: Sql): ShareStore {
  return {
    async save(session) {
      await ensureSchema(sql);
      const id = newShareId();
      await sql`insert into shared_carts (id, session) values (${id}, ${sql.json(clean(session) as never)})`;
      return id;
    },
    async load(id) {
      if (!SHARE_ID.test(id)) return null;
      await ensureSchema(sql);
      const rows = await sql<{ session: unknown }[]>`select session from shared_carts where id = ${id}`;
      const parsed = rows[0] ? SessionSchema.safeParse(rows[0].session) : null;
      return parsed?.success ? parsed.data : null;
    },
  };
}

const holder = globalThis as unknown as { __jholaShares?: ShareStore };
export function defaultShareStore(): ShareStore {
  if (holder.__jholaShares) return holder.__jholaShares;
  const sql = getSql();
  holder.__jholaShares = sql ? createPgShareStore(sql) : createMemoryShareStore();
  return holder.__jholaShares;
}
