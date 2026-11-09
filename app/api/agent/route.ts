import { handleAgentTurn } from "@/lib/agent/api";

export const runtime = "nodejs";
// One cart editor turn, streamed as JSON lines. The turn gives up at 25 s (lib/agent/loop.ts)
// and nginx waits up to 70 s, so the app's own reply always reaches the shopper.

export function POST(req: Request) {
  return handleAgentTurn(req);
}
