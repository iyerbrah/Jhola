/**
 * One turn of the shopping agent: the shopper's message in, a session, a cart and a reply out.
 *
 * Plan -> act -> observe, until the cart passes its checks:
 * - The model calls tools; each runs the moment the model finishes writing it (streaming), so the
 *   shopper sees the understanding line, then the plan, then the cart while the model is still working.
 * - Every edit re-solves and re-checks the cart, and the model reads the result before its next step.
 * - A clean turn ends in code: when the model marks its last edit done and every check passes, code
 *   writes the reply from the cart itself. One model call for most turns.
 * - finish is refused while a check fails unexplained, or if the reply states an amount nobody showed.
 * - A big change (clearing the cart, an expensive swap, a much bigger total) isn't applied: it comes back
 *   for the shopper to confirm.
 * - Limits keep a confused model from running up time or cost. A turn that hits one changes nothing.
 */
import { randomUUID } from "node:crypto";
import type { Product } from "../schema";
import type { CatalogIndex } from "../catalog";
import { costUsd, USD_TO_INR } from "../cost";
import { LlmError, type LlmUsage } from "../llm";
import type { CatalogSearch } from "../search";
import { diffCarts, isEmptyDiff, type CartDiff } from "../cart/diff";
import { endNote } from "../cart/notes";
import { review } from "../cart/review";
import { picksOf, solve } from "../cart/solve";
import type { Brief, Cart, Check, Session } from "../cart/types";
import { planEffort, type ChatInputItem, type ChatModel, type ModelStep, type ToolCall } from "./model";
import { chatInstructions, turnMessage } from "./prompt";
import { amountsIn, EDIT_TOOLS, LOOK_TOOLS, runTool, statusFor, type ChatEvent, type ChatState } from "./tools";

export const CHAT_LIMITS = {
  /** A first build is 2-3 calls; a hard edit (browse, try two options, ask) about 8. Tool calls cost milliseconds. */
  maxToolCalls: 20,
  /** Model calls are what cost time and money. */
  maxModelCalls: 6,
  deadlineMs: 25_000,
  /** Earlier chat messages sent with each turn. */
  historyMessages: 6,
  /** Unsure picks the agent may choose among in a turn (each costs nothing; seeing them costs one model call). */
  maxOffers: 4,
};
export type ChatLimits = typeof CHAT_LIMITS;

export type StopReason = "finished" | "tool_limit" | "model_limit" | "timeout" | "repeated_call" | "no_tool_call" | "provider_error" | "cancelled";
export type ChatTurn = { role: "user" | "assistant"; content: string };

export type TraceStep = { kind: "model" | "tool"; name: string; ok: boolean; ms: number; input_tokens?: number; cached_tokens?: number; output_tokens?: number; error?: string };

export type ChatTurnInput = { session: Session; message: string; history: ChatTurn[] };

export type Solved = { session: Session; cart: Cart; checks: Check[] };

export type ChatTurnResult = {
  /** done: applied. confirm: a big change waits for the shopper (in `pending`). gave_up: nothing changed. */
  status: "done" | "confirm" | "gave_up";
  stop_reason: StopReason;
  reply: string;
  question: { question: string; options: string[] } | null;
  /** What the shopper has now: the new session, or the old one when the turn gave up or needs confirming. */
  session: Session;
  cart: Cart;
  checks: Check[];
  diff: CartDiff;
  note: string[];
  pending: (Solved & { diff: CartDiff; reason: string }) | null;
  meta: {
    trace_id: string;
    finished_by?: "model" | "code";
    model: string;
    model_calls: number;
    tool_calls: number;
    latency_ms: number;
    cost_usd: number | null;
    cost_inr: number | null;
    steps: TraceStep[];
  } & LlmUsage;
};

export type ChatDeps = {
  model: ChatModel;
  products: Product[];
  index: CatalogIndex;
  search: CatalogSearch;
  kinds: Set<string>;
  limits?: Partial<ChatLimits>;
  instructions?: string;
  onEvent?: (e: ChatEvent) => void;
  log?: (line: Record<string, unknown>) => void;
  traceId?: string;
  signal?: AbortSignal;
};

const GAVE_UP: Record<Exclude<StopReason, "finished">, string> = {
  tool_limit: "I couldn't finish that, so I left your cart as it was. Try asking for one thing at a time.",
  model_limit: "I couldn't finish that, so I left your cart as it was. Try asking for one thing at a time.",
  repeated_call: "I got stuck on that one, so I left your cart as it was. Try saying it another way.",
  no_tool_call: "I couldn't work that out, so I left your cart as it was. Try saying it another way.",
  timeout: "That took too long, so I left your cart as it was. Please try again.",
  provider_error: "I'm having trouble right now, so I left your cart as it was. Please try again in a moment.",
  cancelled: "Stopped, so I left your cart as it was.",
};

/** Solves a session as the shopper has it now. */
export function solveSession(session: Session, ctx: { products: Product[]; index: CatalogIndex }): Solved {
  const cart = solve(session, ctx);
  return { session: { ...session, picks: picksOf(cart) }, cart, checks: review(session, cart, ctx.index) };
}

/**
 * Is this change big enough to ask first? Clearing the cart, removing most of it, an expensive swap,
 * or a much bigger total that more people doesn't explain. A first build never is.
 */
export function bigChange(before: Solved, after: Solved, diff: CartDiff): string | null {
  const was = before.cart.lines.filter((l) => l.counted);
  if (!was.length) return null;
  const now = after.cart.lines.filter((l) => l.counted);
  if (!now.length) return "it empties the cart";
  // Removing most of the cart, not reworking it: lines that go aren't replaced by new ones.
  const gone = diff.removed.length - diff.added.length;
  if (diff.removed.length >= 3 && gone >= was.length / 2) return `it removes ${diff.removed.length} of your ${was.length} items`;
  for (const s of diff.swapped) {
    const from = was.find((l) => l.product.id === s.from.product_id);
    const to = now.find((l) => l.product.id === s.to.product_id);
    if (from && to && to.line_total - from.line_total > 300) return `it swaps ${from.product.name} (₹${from.line_total}) for ${to.product.name} (₹${to.line_total})`;
  }
  const rise = after.cart.total - before.cart.total;
  const morePeople = (after.session.brief.people ?? 0) > (before.session.brief.people ?? 0);
  if (!morePeople && rise > Math.max(500, before.cart.total * 0.5)) return `it raises the total from ₹${before.cart.total} to ₹${after.cart.total}`;
  return null;
}

/**
 * Did what the shopper sees as their preferences change (budget, diet, quality, rules)? A new head count
 * alone doesn't count: if it changed no amount, the cart doesn't fit it yet, and the model must say why
 * or fix the amounts.
 */
export function briefMoved(a: Brief, b: Brief): boolean {
  const key = (x: Brief) => JSON.stringify([x.budget_inr, x.diet, x.quality, x.rules.map((r) => r.label).sort()]);
  return key(a) !== key(b);
}

function shortDiff(d: CartDiff): string {
  const parts = [
    ...d.added.map((r) => `added ${r.name}`),
    ...d.removed.map((r) => `removed ${r.name}`),
    ...d.swapped.map((s) => `${s.from.name} → ${s.to.name}`),
    ...d.packs.map((p) => `${p.name} ${p.from} → ${p.to}`),
  ];
  return parts.length > 3 ? `${parts.slice(0, 3).join(", ")} and ${parts.length - 3} more` : parts.join(", ");
}

/** The reply when code ends the turn: what's now true, from the cart itself. */
export function codeReply(first: boolean, before: Cart, after: Cart, d: CartDiff): string {
  const n = after.lines.filter((l) => l.counted).length;
  if (first || !before.lines.length) return `Your cart is ready: ${n} item${n === 1 ? "" : "s"} for ₹${after.total}.`;
  if (isEmptyDiff(d)) return `Done: your preferences are updated, and the cart already fits them (₹${after.total}).`;
  return `Done: ${shortDiff(d)}. ₹${before.total} → ₹${after.total}.`;
}

export async function runChatTurn(input: ChatTurnInput, deps: ChatDeps): Promise<ChatTurnResult> {
  const limits = { ...CHAT_LIMITS, ...deps.limits };
  const instructions = deps.instructions ?? chatInstructions();
  const log = deps.log ?? ((line) => console.log(JSON.stringify(line)));
  const trace_id = deps.traceId ?? randomUUID();
  const started = Date.now();
  const ctx = { products: deps.products, index: deps.index, search: deps.search, kinds: deps.kinds };

  const start = solveSession(input.session, ctx);
  const first = start.session.needs.length === 0;
  const state: ChatState = {
    session: start.session,
    cart: start.cart,
    checks: start.checks,
    message: input.message,
    version: 0,
    edited: false,
    amounts: new Set(),
    question: null,
    start: { cart: start.cart, brief: start.session.brief, needIds: start.session.needs.map((n) => n.id) },
    emit: deps.onEvent,
    maxOffers: limits.maxOffers,
  };
  const opening = turnMessage(state.session, state.cart, state.checks, input.message, deps.index);
  for (const n of amountsIn(opening)) state.amounts.add(n);
  for (const m of input.history) for (const n of amountsIn(m.content)) state.amounts.add(n);
  const conversation: ChatInputItem[] = [
    ...input.history.slice(-limits.historyMessages).map((m): ChatInputItem => ({ kind: "message", role: m.role, content: m.content })),
    { kind: "message", role: "user", content: opening },
  ];

  const usage: LlmUsage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
  const steps: TraceStep[] = [];
  let model = "";
  let modelCalls = 0;
  let toolCalls = 0;
  /** A refusal the shopper should hear about happened this turn: the model writes the reply. */
  let turnHadError = false;
  /** The understanding line and the shopping list have gone to the screen from the streamed arguments. */
  let briefShown = false;
  let planShown = false;
  /** Results by call (name, arguments, session version), for answering repeats without running them again. */
  const results = new Map<string, { output: string; repeats: number }>();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.deadlineMs);
  const cancel = () => controller.abort();
  deps.signal?.addEventListener("abort", cancel);
  if (deps.signal?.aborted) controller.abort();
  const stopped = (): StopReason => (deps.signal?.aborted ? "cancelled" : "timeout");

  const step = (s: TraceStep, extra: Record<string, unknown> = {}) => {
    steps.push(s);
    log({ event: "chat_step", trace_id, step: steps.length, ...s, ...extra });
  };

  const end = (stop_reason: StopReason, reply?: string, finished_by: "model" | "code" = "model"): ChatTurnResult => {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", cancel);
    const finished = stop_reason === "finished";
    const after: Solved = { session: state.session, cart: state.cart, checks: state.checks };
    const diff = diffCarts(start.cart, after.cart);
    const big = finished ? bigChange(start, after, diff) : null;
    const status: ChatTurnResult["status"] = !finished ? "gave_up" : big ? "confirm" : "done";
    const kept = status === "done" ? after : start;
    const cost = model ? costUsd(model, usage) : null;
    const result: ChatTurnResult = {
      status,
      stop_reason,
      reply: !finished ? GAVE_UP[stop_reason as Exclude<StopReason, "finished">] : big ? `That's a big change: ${big}. Want me to go ahead?` : reply!,
      question: status === "done" ? state.question : null,
      session: kept.session,
      cart: kept.cart,
      checks: kept.checks,
      diff: status === "done" ? diff : diffCarts(start.cart, start.cart),
      note: status === "done" ? endNote(kept.session, kept.cart) : [],
      pending: big ? { ...after, diff, reason: big } : null,
      meta: {
        trace_id,
        ...(finished ? { finished_by } : {}),
        model,
        model_calls: modelCalls,
        tool_calls: toolCalls,
        latency_ms: Date.now() - started,
        cost_usd: cost,
        cost_inr: cost == null ? null : Math.round(cost * USD_TO_INR * 100) / 100,
        steps,
        ...usage,
      },
    };
    log({ event: "chat_turn", trace_id, message: input.message.slice(0, 300), status, stop_reason, model_calls: modelCalls, tool_calls: toolCalls, latency_ms: result.meta.latency_ms, cost_usd: cost, ...usage });
    return result;
  };

  try {
    while (true) {
      if (modelCalls >= limits.maxModelCalls) return end("model_limit");
      if (controller.signal.aborted) return end(stopped());

      // What this step did, for deciding whether code can end the turn.
      const flags = { edited: false, saysDone: false, looked: false, failed: false };
      state.offeredNow = false;
      let finished: string | null = null;
      let stop: StopReason | null = null;
      const outputs = new Map<string, string>();
      const thisResponse = new Set<string>();
      let chain: Promise<void> = Promise.resolve();

      const exec = async (call: ToolCall) => {
        if (finished != null || stop) return;
        const key = `${call.name}:${call.arguments}:${state.version}`;
        const earlier = results.get(key);
        if (earlier && thisResponse.has(key)) return void outputs.set(call.call_id, earlier.output); // the same call twice in one step: free
        if (toolCalls >= limits.maxToolCalls) return void (stop = "tool_limit");
        thisResponse.add(key);
        toolCalls++;
        if (earlier) {
          // The same call as an earlier step with nothing changed since: say so once, then stop.
          if (++earlier.repeats >= 2) return void (stop = "repeated_call");
          return void outputs.set(call.call_id, `${earlier.output}\n(You already made this exact call and nothing has changed since. Do something different, or finish.)`);
        }
        const status = statusFor(call.name, call.arguments, deps.index);
        if (status) deps.onEvent?.({ type: "status", text: status });
        const t = Date.now();
        const r = await runTool(call.name, call.arguments, state, ctx);
        step({ kind: "tool", name: call.name, ok: r.ok, ms: Date.now() - t, ...(r.ok ? {} : { error: r.output.slice(0, 200) }) });
        for (const n of amountsIn(r.output)) state.amounts.add(n);
        if (EDIT_TOOLS.has(call.name)) {
          if (r.ok) flags.edited = true;
          try {
            if (JSON.parse(call.arguments)?.done === true) flags.saysDone = true;
          } catch {}
        } else if (LOOK_TOOLS.has(call.name)) flags.looked = true;
        if (!r.ok) flags.failed = true;
        if (!r.ok && r.notable) turnHadError = true;
        if (r.finished) finished = r.finished.reply;
        results.set(key, { output: r.output, repeats: 0 });
        outputs.set(call.call_id, r.output);
      };
      let queued = 0;
      const run = (call: ToolCall) => {
        queued++;
        chain = chain.then(() => exec(call));
      };

      // One model call; a provider failure is retried once if no tool had run yet.
      let res: ModelStep | null = null;
      for (let attempt = 1; attempt <= 2 && !res; attempt++) {
        const t = Date.now();
        const ran = new Set<string>();
        try {
          res = await deps.model.next({
            instructions,
            input: conversation,
            signal: controller.signal,
            // The planning step of a turn thinks a little first; the steps after it act on tool results.
            effort: modelCalls === 0 ? planEffort() : "none",
            // The understanding line, the moment the model has written it, before the rest of the call.
            onArgs: (name, partial) => {
              if (name !== "update_cart") return;
              if (!briefShown) {
                const m = partial.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                if (m) {
                  briefShown = true;
                  try {
                    const summary = JSON.parse(`"${m[1]}"`) as string;
                    if (summary && summary !== state.session.brief.summary) deps.onEvent?.({ type: "brief", brief: { ...state.session.brief, summary } });
                  } catch {}
                }
              }
              // The shopping list, once its closing bracket has arrived (strings may hold brackets).
              if (!planShown) {
                const m = partial.match(/"shopping_list"\s*:\s*(\[(?:[^\]"]|"(?:[^"\\]|\\.)*")*\])/);
                if (m) {
                  planShown = true;
                  try {
                    const lines = (JSON.parse(m[1]) as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 16);
                    if (lines.length) deps.onEvent?.({ type: "plan", lines });
                  } catch {}
                }
              }
            },
            onCall: (c) => {
              ran.add(c.call_id);
              run(c);
            },
          });
          // A model that doesn't stream hands over its calls only at the end.
          for (const c of res.calls) if (!ran.has(c.call_id)) run(c);
          step({ kind: "model", name: res.model, ok: true, ms: Date.now() - t, ...res.usage }, { tool_calls: res.calls.map((c) => c.name) });
        } catch (err) {
          step({ kind: "model", name: model || "model", ok: false, ms: Date.now() - t, error: err instanceof LlmError ? err.kind : "unexpected" });
          await chain;
          if (controller.signal.aborted || (err instanceof LlmError && err.kind === "timeout")) return end(stopped());
          if (!(err instanceof LlmError)) throw err;
          if (attempt === 2 || queued > 0) return end("provider_error");
        }
      }
      modelCalls++;
      model = res!.model;
      usage.input_tokens += res!.usage.input_tokens;
      usage.cached_tokens += res!.usage.cached_tokens;
      usage.output_tokens += res!.usage.output_tokens;
      await chain;

      if (res!.calls.length === 0) {
        // Shouldn't happen (a tool call is required), but plain text counts as finish.
        if (!res!.text.trim()) return end("no_tool_call");
        await exec({ call_id: "text", name: "finish", arguments: JSON.stringify({ reply: res!.text }) });
        return finished != null ? end("finished", finished) : end("no_tool_call");
      }
      conversation.push({ kind: "model", calls: res!.calls, replay: res!.replay });
      for (const c of res!.calls) conversation.push({ kind: "tool_result", call_id: c.call_id, output: outputs.get(c.call_id) ?? "(not run: the turn ended)" });

      if (stop) return end(stop);
      if (finished != null) return end("finished", finished);
      // The model says the request is done and code can confirm it: end now instead of paying a model call
      // for "finish". Only for a clean turn: after any refused call there's something to explain.
      const clean = !turnHadError && !flags.failed && state.checks.every((c) => c.status !== "fail");
      // Code writes the reply only when it has something true to say: a first cart, or a change the
      // shopper can see. An edit that changed nothing visible goes back to the model to explain.
      const d = diffCarts(start.cart, state.cart);
      const visible = first || !isEmptyDiff(d) || briefMoved(start.session.brief, state.session.brief);
      // Close calls the agent hasn't seen yet: it gets one more step to choose among them.
      if (flags.edited && flags.saysDone && !flags.looked && clean && visible && !state.offeredNow) return end("finished", codeReply(first, start.cart, state.cart, d), "code");
    }
  } finally {
    clearTimeout(timer);
  }
}
