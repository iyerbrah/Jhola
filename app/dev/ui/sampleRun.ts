import { cartRecord } from "@/lib/chat/log";
import { defaultRequestLog, type RequestRecord } from "@/lib/log/requestLog";
import type { Cart } from "@/lib/cart/types";

/** The sample run's session id: fixed, so it's written once per server process. */
export const SAMPLE_RUN = "00000000-0000-4000-8000-00000000d001";

/**
 * Development only, and only with the in-memory log (no DATABASE_URL): writes one sample run of two chat
 * turns, with trace steps, a failed check and a tool error, so History's run page can be checked without
 * a model call. Never touches a real database.
 */
export async function seedSampleRun(cart: Cart, summary: string): Promise<void> {
  if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL) return;
  const log = defaultRequestLog();
  if (await log.run(SAMPLE_RUN)) return;
  const at = Date.now() - 5 * 60_000;
  const turn = (i: number, o: Partial<RequestRecord>, meta: Record<string, unknown>): RequestRecord => ({
    id: `00000000-0000-4000-8000-00000000d10${i}`,
    kind: "agent",
    created_at: new Date(at + i * 60_000),
    visitor: "sample",
    query: "",
    status: "done",
    cached: false,
    model: "gpt-5.4-mini",
    latency_ms: 0,
    catalog_size: 1,
    meta: { chat: true, session_id: SAMPLE_RUN, summary, finished_by: "code", ...meta },
    carts: [cartRecord("after", cart, summary)],
    steps: [],
    ...o,
  });
  await log.record(
    turn(
      1,
      {
        query: "Stuff for pasta night for 4, vegetarian, around ₹600. No onions please",
        latency_ms: 4200,
        cost_usd: 0.0061,
        input_tokens: 11800,
        cached_tokens: 9200,
        output_tokens: 640,
        model_calls: 1,
        tool_calls: 4,
        steps: [
          { kind: "model", name: "gpt-5.4-mini", ok: true, ms: 3100, input_tokens: 11800, cached_tokens: 9200, output_tokens: 640 },
          { kind: "tool", name: "update_brief", ok: true, ms: 2 },
          { kind: "tool", name: "set_needs", ok: false, ms: 3, error: "No such kind: basil" },
          { kind: "tool", name: "set_needs", ok: true, ms: 9 },
          { kind: "tool", name: "finish", ok: true, ms: 1 },
        ],
      },
      { reply: `Here's a vegetarian pasta night for 4 at ₹${cart.total + 40}. I skipped onions and guessed the cream.`, ready: false, failed_checks: 1, not_ready: ["checklist: Under ₹600 by ₹40"] },
    ),
  );
  await log.record(
    turn(
      2,
      {
        query: "Make it a bit cheaper",
        latency_ms: 2300,
        cost_usd: 0.0032,
        input_tokens: 12900,
        cached_tokens: 11600,
        output_tokens: 210,
        model_calls: 1,
        tool_calls: 2,
        steps: [
          { kind: "model", name: "gpt-5.4-mini", ok: true, ms: 1900, input_tokens: 12900, cached_tokens: 11600, output_tokens: 210 },
          { kind: "tool", name: "set_quality", ok: true, ms: 4 },
          { kind: "tool", name: "finish", ok: true, ms: 1 },
        ],
      },
      { reply: `Done: cheaper brands, now ₹${cart.total}.`, ready: true, failed_checks: 0, not_ready: [] },
    ),
  );
}
