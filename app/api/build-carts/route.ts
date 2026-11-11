import { handleBuildCarts } from "@/lib/buildCartsApi";

export const runtime = "nodejs";
// One plan call + 3 parallel cart calls + at most one repair. The handler gives up with a 502
// at 50 s (lib/buildCartsApi.ts), and nginx waits up to 70 s (deploy/nginx/jhola.conf), so the app's own
// error always reaches the shopper instead of an nginx timeout page.

export function POST(req: Request) {
  return handleBuildCarts(req);
}
