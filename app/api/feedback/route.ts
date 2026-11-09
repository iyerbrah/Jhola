import { handleFeedback } from "@/lib/feedback";

export const runtime = "nodejs";

export function POST(req: Request) {
  return handleFeedback(req);
}
