import { handleShare } from "@/lib/chat/api";

export const runtime = "nodejs";

export function POST(req: Request) {
  return handleShare(req);
}
