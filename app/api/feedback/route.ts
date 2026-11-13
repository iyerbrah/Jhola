import { handleFeedback } from "@/lib/log/feedback";

export const runtime = "nodejs";

export function POST(req: Request) {
  return handleFeedback(req);
}
