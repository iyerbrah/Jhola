import { handleBuildCarts } from "@/lib/api";

export const runtime = "nodejs";
// One plan call + 3 parallel cart calls + at most one repair, with headroom. Fails with 502 at 50 s.
export const maxDuration = 60;

export function POST(req: Request) {
  return handleBuildCarts(req);
}
