/**
 * One turn of the cart editor agent: the shopper's message in, edited carts and a reply out.
 *
 * The model calls tools until it calls finish, which code accepts only when every cart it
 * changed passes every rule. Limits keep a confused model from running up time or cost:
 * a turn that hits one changes nothing and says so. See docs/agent-plan.md.
 */
import { randomUUID } from "node:crypto";
import type { CatalogIndex } from "../catalog";
import { costUsd } from "../cost";
import { LlmError, type LlmUsage } from "../llm";
import type { Product } from "../schema";
import type { AgentCart } from "./carts";
import { diffCarts, type CartChange } from "./changes";
import type { AgentInputItem, AgentModel, ModelStep, ToolCall } from "./model";
import { AGENT_INSTRUCTIONS, turnMessage, type ChatTurn } from "./prompt";
import type { CatalogSearch } from "./search";
import { runTool, statusFor, type AgentState } from "./tools";

export const LIMITS = {
  /** A normal edit takes 2-5 tool calls; more means the agent is lost. */
  maxToolCalls: 8,
  maxModelCalls: 5,
  deadlineMs: 25_000,
  /** Earlier chat messages sent with each turn. */
  historyMessages: 6,
};
export type AgentLimits = typeof LIMITS;

export type StopReason = "finished" | "tool_limit" | "model_limit" | "timeout" | "repeated_call" | "no_tool_call" | "provider_error";

export type AgentTurnInput = {
  carts: AgentCart[];
  /** 0-based index of the cart the shopper is looking at. */
  active: number;
  message: string;
  history: ChatTurn[];
};

export type AgentTurnResult = {
  status: "done" | "gave_up";
  stop_reason: StopReason;
  reply: string;
  /** The new carts. When the turn gave up, these are the carts it started with. */
  carts: AgentCart[];
  changes: CartChange[];
  meta: {
    trace_id: string;
    model: string;
    model_calls: number;
    tool_calls: number;
    latency_ms: number;
    cost_usd: number | null;
  } & LlmUsage;
};

export type AgentEvent = { type: "status"; text: string };

export type AgentDeps = {
  model: AgentModel;
  index: CatalogIndex;
  products: Product[];
  search: CatalogSearch;
  limits?: Partial<AgentLimits>;
  /** Progress lines for the shopper while the turn runs. */
  onEvent?: (e: AgentEvent) => void;
  /** One JSON object per step and one per turn. Defaults to the server log. */
  log?: (line: Record<string, unknown>) => void;
  traceId?: string;
};

const GAVE_UP: Record<Exclude<StopReason, "finished">, string> = {
  tool_limit: "I couldn't finish that change, so I left your carts as they were. Try asking for one thing at a time.",
  model_limit: "I couldn't finish that change, so I left your carts as they were. Try asking for one thing at a time.",
  repeated_call: "I got stuck on that one, so I left your carts as they were. Try saying it another way.",
  no_tool_call: "I couldn't work out that change, so I left your carts as they were. Try saying it another way.",
  timeout: "That took too long, so I left your carts as they were. Please try again.",
  provider_error: "I'm having trouble right now, so I left your carts as they were. Please try again in a moment.",
};

export async function runAgentTurn(input: AgentTurnInput, deps: AgentDeps): Promise<AgentTurnResult> {
  const limits = { ...LIMITS, ...deps.limits };
  const log = deps.log ?? ((line) => console.log(JSON.stringify(line)));
  const trace_id = deps.traceId ?? randomUUID();
  const started = Date.now();

  const state: AgentState = { carts: structuredClone(input.carts), active: input.active, version: 0, touched: new Set() };
  const conversation: AgentInputItem[] = [
    ...input.history.slice(-limits.historyMessages).map((m): AgentInputItem => ({ kind: "message", role: m.role, content: m.content })),
    { kind: "message", role: "user", content: turnMessage(state.carts, state.active, input.message, deps.index) },
  ];

  const usage: LlmUsage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
  let model = "";
  let modelCalls = 0;
  let toolCalls = 0;
  let step = 0;
  /** Results by call (name, arguments, cart version), for answering repeats without running them again. */
  const results = new Map<string, { output: string; repeats: number }>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.deadlineMs);

  const end = (stop_reason: StopReason, reply?: string): AgentTurnResult => {
    clearTimeout(timer);
    const done = stop_reason === "finished";
    const carts = done ? state.carts : input.carts;
    const result: AgentTurnResult = {
      status: done ? "done" : "gave_up",
      stop_reason,
      reply: done ? reply! : GAVE_UP[stop_reason as Exclude<StopReason, "finished">],
      carts,
      changes: done ? diffCarts(input.carts, carts) : [],
      meta: { trace_id, model, model_calls: modelCalls, tool_calls: toolCalls, latency_ms: Date.now() - started, cost_usd: model ? costUsd(model, usage) : null, ...usage },
    };
    log({
      event: "agent_turn",
      message: input.message.slice(0, 300),
      status: result.status,
      stop_reason,
      changed_carts: result.changes.map((c) => c.cart),
      ...result.meta,
    });
    return result;
  };

  /** One model call, retried once if the provider fails (not when time is up). */
  const callModel = async (): Promise<ModelStep> => {
    const attempt = async () => {
      const t = Date.now();
      try {
        const res = await deps.model.next({ instructions: AGENT_INSTRUCTIONS, input: conversation, signal: controller.signal });
        log({ event: "agent_step", trace_id, step: ++step, kind: "model", name: res.model, ok: true, ms: Date.now() - t, tool_calls: res.calls.map((c) => c.name), ...res.usage });
        return res;
      } catch (err) {
        log({ event: "agent_step", trace_id, step: ++step, kind: "model", ok: false, ms: Date.now() - t, error: err instanceof LlmError ? err.kind : "unexpected" });
        throw err;
      }
    };
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof LlmError) || controller.signal.aborted || err.kind === "timeout") throw err;
      return attempt();
    }
  };

  const runCall = async (call: ToolCall) => {
    const status = statusFor(call.name, call.arguments, deps.index);
    if (status) deps.onEvent?.({ type: "status", text: status });
    const t = Date.now();
    const result = await runTool(call.name, call.arguments, state, deps);
    toolCalls++;
    log({ event: "agent_step", trace_id, step: ++step, kind: "tool", name: call.name, ok: result.ok, ms: Date.now() - t, ...(result.ok ? {} : { error: result.output.slice(0, 200) }) });
    return result;
  };

  try {
    while (true) {
      if (modelCalls >= limits.maxModelCalls) return end("model_limit");
      if (controller.signal.aborted) return end("timeout");
      let res: ModelStep;
      try {
        res = await callModel();
      } catch (err) {
        if (controller.signal.aborted || (err instanceof LlmError && err.kind === "timeout")) return end("timeout");
        if (err instanceof LlmError) return end("provider_error");
        throw err;
      }
      modelCalls++;
      model = res.model;
      usage.input_tokens += res.usage.input_tokens;
      usage.cached_tokens += res.usage.cached_tokens;
      usage.output_tokens += res.usage.output_tokens;

      if (res.calls.length === 0) {
        // Shouldn't happen (a tool call is required), but plain text is treated as finish.
        if (!res.text.trim()) return end("no_tool_call");
        const result = await runCall({ call_id: "text", name: "finish", arguments: JSON.stringify({ reply: res.text }) });
        return result.finished ? end("finished", result.finished.reply) : end("no_tool_call");
      }

      conversation.push({ kind: "model", calls: res.calls, replay: res.replay });
      const thisResponse = new Set<string>();
      for (const call of res.calls) {
        const key = `${call.name}:${call.arguments}:${state.version}`;
        const earlier = results.get(key);
        // The same call twice in one response (e.g. one search per cart): answer it again, free.
        if (earlier && thisResponse.has(key)) {
          conversation.push({ kind: "tool_result", call_id: call.call_id, output: earlier.output });
          continue;
        }
        if (toolCalls >= limits.maxToolCalls) return end("tool_limit");
        thisResponse.add(key);
        // The same call as in an earlier step, with the carts unchanged, can only give the same answer.
        // Say so once; a second time means the agent is going round in circles.
        if (earlier) {
          if (++earlier.repeats >= 2) return end("repeated_call");
          toolCalls++;
          conversation.push({
            kind: "tool_result",
            call_id: call.call_id,
            output: `${earlier.output}\n(You already made this exact call and nothing has changed since, so this is the same result. Do something different, or finish.)`,
          });
          continue;
        }
        const result = await runCall(call);
        if (result.finished) return end("finished", result.finished.reply);
        results.set(key, { output: result.output, repeats: 0 });
        conversation.push({ kind: "tool_result", call_id: call.call_id, output: result.output });
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
