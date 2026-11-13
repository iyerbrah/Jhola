/** Small helpers shared by the API handlers (chat, solve, share, feedback, orders, export). */

/**
 * The caller's IP, for rate limits. x-real-ip comes first: nginx (deploy/nginx/jhola.conf) sets it
 * to the real client address, overwriting anything the caller sent. x-forwarded-for is only a
 * fallback, because behind a proxy that appends to it, its first entry is whatever the caller wrote.
 * This is safe because the app listens on 127.0.0.1 only, so every request comes through nginx.
 */
export function clientIp(req: Request): string {
  return clientIpFrom(req.headers);
}

/** The same, from the headers alone (server actions have no Request). */
export function clientIpFrom(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return real || forwarded || "local";
}

/** A JSON response that browsers and proxies must not cache. */
export const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
