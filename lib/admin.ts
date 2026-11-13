/**
 * The admin key: what unlocks a run's messages on History and the log export.
 *
 * ADMIN_KEY (or the older HISTORY_KEY) is set on the server. Typing it once sets `jhola_admin`, a signed
 * cookie (HttpOnly, SameSite=Strict, 12 hours): its value is the expiry and an HMAC of it keyed from the
 * admin key, so changing the key signs everyone out, and it can't be forged or extended. The key never
 * appears in a URL. Wrong guesses are rate-limited per address.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createMemoryLimiter, createUpstashLimiter, redisFromEnv, type Limiter } from "./ratelimit";

export const ADMIN_COOKIE = "jhola_admin";
export const ADMIN_HOURS = 12;

/** The configured key, or null when private views are turned off. */
export function adminKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.ADMIN_KEY?.trim() || env.HISTORY_KEY?.trim() || null;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Is this the admin key? Compared in constant time. */
export function keyMatches(input: string, key: string | null): boolean {
  if (!key || !input) return false;
  return timingSafeEqual(digest(input), digest(key));
}

const sign = (expiry: number, key: string) => createHmac("sha256", `jhola-admin|${key}`).update(String(expiry)).digest("base64url");

/** A cookie value that lasts ADMIN_HOURS from now. */
export function adminToken(key: string, now = Date.now()): string {
  const expiry = now + ADMIN_HOURS * 3600_000;
  return `${expiry}.${sign(expiry, key)}`;
}

/** Is this cookie value one we signed with this key, and not expired? */
export function tokenValid(token: string | undefined, key: string | null, now = Date.now()): boolean {
  if (!token || !key) return false;
  const [e, mac] = token.split(".");
  const expiry = Number(e);
  if (!Number.isFinite(expiry) || expiry <= now || !mac) return false;
  const want = Buffer.from(sign(expiry, key));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: ADMIN_HOURS * 3600,
});

// Ten tries an hour per address: plenty for a typo, too few to guess.
const holder = globalThis as unknown as { __jholaKeyLimiter?: Limiter };
export function keyLimiter(): Limiter {
  if (holder.__jholaKeyLimiter) return holder.__jholaKeyLimiter;
  const redis = redisFromEnv();
  const config = { perHour: 10, perDay: 500 };
  holder.__jholaKeyLimiter = redis ? createUpstashLimiter(redis, config, "acb:admin:rl") : createMemoryLimiter(config);
  return holder.__jholaKeyLimiter;
}

export type KeyCheck = "ok" | "wrong" | "off" | "limited";

/** Checks a typed key, counting the try against the address's limit. */
export async function checkKey(input: string, ip: string, limiter: Limiter = keyLimiter(), key = adminKey()): Promise<KeyCheck> {
  if (!key) return "off";
  try {
    if (!(await limiter.check(ip)).ok) return "limited";
  } catch {
    // A broken limiter shouldn't lock the owner out.
  }
  return keyMatches(input, key) ? "ok" : "wrong";
}

export const KEY_MESSAGES: Record<Exclude<KeyCheck, "ok">, string> = {
  wrong: "That key isn't right.",
  off: "Private logs are turned off on this site.",
  limited: "Too many tries. Wait an hour and try again.",
};
