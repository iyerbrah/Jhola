/**
 * The model behind the shopping agent, as a small interface: given the conversation so far, return the
 * next tool calls. The real one streams: each tool call is handed to `onCall` the moment the model
 * finishes writing it, and partial arguments as they arrive, so the shopper sees "Pasta night, 4 people…"
 * while the model is still writing the needs. Tests use a scripted fake; the loop doesn't care which.
 */
import type { ResponseInputItem, ResponseOutputItem, ResponseStreamEvent, ResponseUsage } from "openai/resources/responses/responses";
import { classifyError, getClient, isReasoningModel, LlmError, modelName, openAiOnly, toUsage, type LlmUsage } from "../llm";
import { TOOL_SPECS } from "./tools";

export type ToolCall = { call_id: string; name: string; arguments: string };

export type ModelStep = {
  calls: ToolCall[];
  text: string;
  usage: LlmUsage;
  model: string;
  /** The provider's own output items, sent back as-is on the next call. */
  replay: unknown[];
};

export type ChatInputItem =
  | { kind: "message"; role: "user" | "assistant"; content: string }
  | { kind: "model"; calls: ToolCall[]; replay: unknown[] }
  | { kind: "tool_result"; call_id: string; output: string };

export type Effort = "none" | "low";

export interface ChatModel {
  next(args: {
    instructions: string;
    input: ChatInputItem[];
    signal: AbortSignal;
    /** A tool call the model has finished writing. */
    onCall?: (call: ToolCall) => void;
    /** A tool call's arguments so far, while the model is still writing them. */
    onArgs?: (name: string, partial: string) => void;
    /** How much the model may think first. The planning step of a turn thinks a little; the rest don't. */
    effort?: Effort;
  }): Promise<ModelStep>;
}

export function toOpenAiInput(items: ChatInputItem[]): ResponseInputItem[] {
  return items.flatMap((it): ResponseInputItem[] => {
    if (it.kind === "message") return [{ role: it.role, content: it.content }];
    if (it.kind === "tool_result") return [{ type: "function_call_output", call_id: it.call_id, output: it.output }];
    if (it.replay.length) return it.replay as ResponseInputItem[];
    return it.calls.map((c) => ({ type: "function_call", call_id: c.call_id, name: c.name, arguments: c.arguments }));
  });
}

const tools = () => TOOL_SPECS.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters as unknown as Record<string, unknown>, strict: true }));

function body(instructions: string, input: ChatInputItem[], effort: Effort) {
  const model = modelName();
  return {
    model,
    instructions,
    input: toOpenAiInput(input),
    tools: tools(),
    tool_choice: "required" as const,
    parallel_tool_calls: true,
    max_output_tokens: 3000,
    ...openAiOnly({ prompt_cache_key: "jhola-chat-v1" }),
    ...(isReasoningModel(model) ? { reasoning: { effort } } : {}),
  };
}

const callOf = (o: ResponseOutputItem): ToolCall | null => (o.type === "function_call" ? { call_id: o.call_id, name: o.name, arguments: o.arguments } : null);

function fail(err: unknown, signal: AbortSignal): never {
  if (err instanceof LlmError) throw err;
  if (signal.aborted) throw new LlmError("The turn ran out of time", "timeout");
  throw new LlmError(err instanceof Error ? err.message : String(err), classifyError(err));
}

/** gpt-5.4-mini (by default) through the Responses API, streamed. LLM_STREAM=0 turns streaming off. */
export const planEffort = (): Effort => (process.env.LLM_CHAT_PLAN_EFFORT === "none" ? "none" : "low");
export const openAiChatModel: ChatModel = {
  async next({ instructions, input, signal, onCall, onArgs, effort = "none" }) {
    const stream = process.env.LLM_STREAM !== "0";
    try {
      if (!stream) {
        const res = await getClient().responses.create(body(instructions, input, effort), { signal });
        const calls = res.output.flatMap((o) => callOf(o) ?? []);
        for (const c of calls) onCall?.(c);
        return { calls, text: res.output_text ?? "", model: res.model, replay: res.output, usage: toUsage(res.usage) };
      }
      const events = await getClient().responses.create({ ...body(instructions, input, effort), stream: true }, { signal });
      const calls: ToolCall[] = [];
      /** Tool calls being written, by output index: their name and arguments so far. */
      const writing = new Map<number, { name: string; args: string }>();
      let output: ResponseOutputItem[] = [];
      let usage: ResponseUsage | null | undefined;
      let model = modelName();
      let text = "";
      for await (const e of events as AsyncIterable<ResponseStreamEvent>) {
        if (e.type === "response.output_item.added" && e.item.type === "function_call") {
          writing.set(e.output_index, { name: e.item.name, args: "" });
        } else if (e.type === "response.function_call_arguments.delta") {
          const w = writing.get(e.output_index);
          if (w) {
            w.args += e.delta;
            onArgs?.(w.name, w.args);
          }
        } else if (e.type === "response.output_item.done") {
          const c = callOf(e.item);
          if (c) {
            calls.push(c);
            onCall?.(c);
          }
        } else if (e.type === "response.output_text.delta") {
          text += e.delta;
        } else if (e.type === "response.completed" || e.type === "response.incomplete") {
          output = e.response.output;
          usage = e.response.usage;
          model = e.response.model;
        } else if (e.type === "response.failed") {
          throw new LlmError(e.response.error?.message ?? "The model failed", "provider");
        } else if (e.type === "error") {
          throw new LlmError(e.message ?? "The model failed", "provider");
        }
      }
      return { calls, text, model, replay: output.length ? output : calls.map((c) => ({ type: "function_call", ...c })), usage: toUsage(usage) };
    } catch (err) {
      fail(err, signal);
    }
  },
};
