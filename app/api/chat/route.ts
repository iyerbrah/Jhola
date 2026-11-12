import { handleChat } from "@/lib/chat/api";
// One shopping-agent turn, streamed as JSON lines. The turn gives up at 25 s (lib/chat/loop.ts)
// and nginx waits up to 70 s, so the app's own reply always reaches the shopper.

export const runtime = "nodejs";

export function POST(req: Request) {
  return handleChat(req);
}
