import { adminKey, keyLimiter } from "@/lib/admin";
import { handleExport } from "@/lib/log/export";
import { defaultRequestLog } from "@/lib/log/requestLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleExport(req, { requestLog: defaultRequestLog(), limiter: keyLimiter(), key: adminKey() });
}
