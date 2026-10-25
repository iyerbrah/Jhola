import type { Redis } from "@upstash/redis";
import { costUsd } from "./cost";
import type { BuildCartsResponse } from "./schema";

/** One generation: what was asked, what came back, and what it cost. */
export type HistoryEntry = BuildCartsResponse & {
  id: string;
  at: string; // ISO time
  query: string;
  cost_usd: number | null;
};

export interface HistoryStore {
  add(query: string, res: BuildCartsResponse): Promise<void>;
  list(limit?: number): Promise<HistoryEntry[]>;
}

const KEY = "acb:history";
const KEEP = 1000; // newest generations kept

export function toEntry(query: string, res: BuildCartsResponse, now = new Date()): HistoryEntry {
  return {
    ...res,
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    at: now.toISOString(),
    query,
    cost_usd: costUsd(res.meta.model, res.meta),
  };
}

export function createRedisHistory(redis: Redis): HistoryStore {
  return {
    async add(query, res) {
      await redis.lpush(KEY, toEntry(query, res));
      await redis.ltrim(KEY, 0, KEEP - 1);
    },
    async list(limit = KEEP) {
      return redis.lrange<HistoryEntry>(KEY, 0, limit - 1);
    },
  };
}

/** For tests and when Upstash isn't configured. Lost when the server restarts. */
export function createMemoryHistory(): HistoryStore {
  const entries: HistoryEntry[] = [];
  return {
    async add(query, res) {
      entries.unshift(toEntry(query, res));
      entries.length = Math.min(entries.length, KEEP);
    },
    async list(limit = KEEP) {
      return entries.slice(0, limit);
    },
  };
}

let shared: HistoryStore | null = null;

/** The app's history: Upstash when configured, otherwise in memory. Shared by the API and /history. */
export function defaultHistory(redis: Redis | null): HistoryStore {
  shared ??= redis ? createRedisHistory(redis) : createMemoryHistory();
  return shared;
}
