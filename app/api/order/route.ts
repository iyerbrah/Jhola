import { handleOrder } from "@/lib/log/order";

export const runtime = "nodejs";

export function POST(req: Request) {
  return handleOrder(req);
}
