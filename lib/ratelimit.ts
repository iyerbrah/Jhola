import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type LimitResult = { ok: true } | { ok: false; retryAfter: number; scope: "ip" | "daily" };

export interface Limiter {
  check(ip: string): Promise<LimitResult>;
}

export type LimitConfig = { perHour: number; perDay: number };

export function limitConfigFromEnv(): LimitConfig {
  const num = (v: string | undefined, fallback: number) => (v && Number(v) > 0 ? Number(v) : fallback);
  return { perHour: num(process.env.RATE_LIMIT_PER_HOUR, 10), perDay: num(process.env.DAILY_REQUEST_CAP, 300) };
}

/** The Upstash Redis client, or null if it isn't configured. */
export function redisFromEnv(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

const secondsUntil = (resetMs: number) => Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));

/** Shared limits stored in Upstash, so they hold across every serverless instance. */
export function createUpstashLimiter(redis: Redis, config: LimitConfig): Limiter & { reset(ip: string): Promise<void> } {
  const perIp = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(config.perHour, "1 h"), prefix: "acb:rl:ip" });
  const daily = new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(config.perDay, "1 d"), prefix: "acb:rl:day" });
  return {
    async check(ip) {
      const a = await perIp.limit(ip);
      if (!a.success) return { ok: false, retryAfter: secondsUntil(a.reset), scope: "ip" };
      const b = await daily.limit("global");
      if (!b.success) return { ok: false, retryAfter: secondsUntil(b.reset), scope: "daily" };
      return { ok: true };
    },
    async reset(ip) {
      await perIp.resetUsedTokens(ip);
    },
  };
}

/** Same limits kept in memory. Only for local development and tests (each instance counts alone). */
export function createMemoryLimiter(config: LimitConfig, now: () => number = Date.now): Limiter {
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  const hits = new Map<string, number[]>();
  let day = { start: now(), count: 0 };
  return {
    async check(ip) {
      const t = now();
      const recent = (hits.get(ip) ?? []).filter((x) => t - x < HOUR);
      if (recent.length >= config.perHour) {
        hits.set(ip, recent);
        return { ok: false, retryAfter: Math.ceil((recent[0] + HOUR - t) / 1000), scope: "ip" };
      }
      recent.push(t);
      hits.set(ip, recent);
      if (t - day.start >= DAY) day = { start: t, count: 0 };
      if (day.count >= config.perDay) return { ok: false, retryAfter: Math.ceil((day.start + DAY - t) / 1000), scope: "daily" };
      day.count++;
      return { ok: true };
    },
  };
}
