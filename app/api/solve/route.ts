import { handleSolve } from "@/lib/chat/api";

export const runtime = "nodejs";

export function POST(req: Request) {
  return handleSolve(req);
}
