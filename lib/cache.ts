import { createHash } from "node:crypto";
import type { Redis } from "@upstash/redis";
import type { BuildCartsResponse } from "./schema";

/** Bump this when the prompt, catalog or pipeline changes, so old answers aren't reused. */
export const CACHE_VERSION = "v17"; // v17: unit mix-up guard, dish-suitable budget picks
// Prices are a fixed snapshot and any catalog or prompt change bumps CACHE_VERSION, so answers can live a month.
const TTL_SECONDS = 30 * 24 * 3600;

export interface ResponseCache {
  get(query: string): Promise<BuildCartsResponse | null>;
  set(query: string, res: BuildCartsResponse): Promise<void>;
}

/** "  Paneer Butter Masala for 4!! " and "paneer butter masala for 4" share one entry. */
export function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

function key(query: string, model: string): string {
  const hash = createHash("sha256").update(normalizeQuery(query)).digest("hex").slice(0, 32);
  return `acb:cache:${CACHE_VERSION}:${model}:${hash}`;
}

export function createRedisCache(redis: Redis, model: string): ResponseCache {
  return {
    async get(query) {
      return (await redis.get<BuildCartsResponse>(key(query, model))) ?? null;
    },
    async set(query, res) {
      await redis.set(key(query, model), res, { ex: TTL_SECONDS });
    },
  };
}

export const noCache: ResponseCache = { get: async () => null, set: async () => {} };
