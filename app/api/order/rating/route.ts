import { handleOrderRating } from "@/lib/log/order";

export const runtime = "nodejs";

export function POST(req: Request) {
  return handleOrderRating(req);
}
