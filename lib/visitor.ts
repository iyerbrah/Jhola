import { createHmac, randomBytes } from "node:crypto";

/**
 * A visitor's ID for counting daily visitors without storing addresses: an HMAC of the address and
 * today's date, keyed by VISITOR_SECRET. The same person on the same day gets the same ID; it can't
 * be turned back into an address, and it changes every day, so visits can't be linked across days.
 * IPv6 addresses count by their /64 prefix (one household or phone), not the full address.
 */
let fallbackSecret: string | null = null;

function secret(): string {
  if (process.env.VISITOR_SECRET) return process.env.VISITOR_SECRET;
  // Without a secret (your own machine), use one per process: counts still work until a restart.
  fallbackSecret ??= randomBytes(32).toString("hex");
  return fallbackSecret;
}

export function visitorId(ip: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const key = ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip;
  return createHmac("sha256", secret()).update(`${day}|${key}`).digest("hex").slice(0, 16);
}
