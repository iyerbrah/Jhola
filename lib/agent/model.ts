/**
 * The model behind the cart editor agent, as a small interface: given the conversation so far,
 * return the next tool calls. The loop (lib/agent/loop.ts) only talks to this interface, so tests
 * use a scripted fake and the provider can change without touching the loop.
 */
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { classifyError, getClient, isReasoningModel, LlmError, modelName, type LlmUsage } from "../llm";
import { TOOL_SPECS } from "./tools";

export type ToolCall = { call_id: string; name: string; arguments: string };

/** One model response: the tools it wants to call (or, rarely, plain text). */
export type ModelStep = {
  calls: ToolCall[];
  text: string;
  usage: LlmUsage;
  model: string;
  /** The provider's own output items, sent back as-is on the next call. */
  replay: unknown[];
};

export type AgentInputItem =
  | { kind: "message"; role: "user" | "assistant"; content: string }
  | { kind: "model"; calls: ToolCall[]; replay: unknown[] }
  | { kind: "tool_result"; call_id: string; output: string };

export interface AgentModel {
  next(args: { instructions: string; input: AgentInputItem[]; signal: AbortSignal }): Promise<ModelStep>;
}

function toOpenAiInput(items: AgentInputItem[]): ResponseInputItem[] {
  return items.flatMap((it): ResponseInputItem[] => {
    if (it.kind === "message") return [{ role: it.role, content: it.content }];
    if (it.kind === "tool_result") return [{ type: "function_call_output", call_id: it.call_id, output: it.output }];
    if (it.replay.length) return it.replay as ResponseInputItem[];
    return it.calls.map((c) => ({ type: "function_call", call_id: c.call_id, name: c.name, arguments: c.arguments }));
  });
}

/** LLM_AGENT_SERVICE_TIER for the agent alone, else the cart builder's LLM_SERVICE_TIER. */
const serviceTier = () => (process.env.LLM_AGENT_SERVICE_TIER || process.env.LLM_SERVICE_TIER || undefined) as "priority" | undefined;

/** gpt-5.4-mini through the Responses API, with strict tool schemas and a tool call required every step. */
export const openAiAgentModel: AgentModel = {
  async next({ instructions, input, signal }) {
    const model = modelName();
    try {
      const res = await getClient().responses.create(
        {
          model,
          instructions,
          input: toOpenAiInput(input),
          tools: TOOL_SPECS.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters, strict: true })),
          tool_choice: "required",
          parallel_tool_calls: true,
          max_output_tokens: 1500,
          // Same key every turn, so the instructions and tool schemas stay cached.
          prompt_cache_key: "jhola-agent-v1",
          // Optional: OpenAI's faster, pricier tier ("priority"). Unset = the standard tier.
          ...(serviceTier() ? { service_tier: serviceTier() } : {}),
          ...(isReasoningModel(model) ? { reasoning: { effort: (process.env.LLM_AGENT_EFFORT as "none" | "low") || "none" } } : {}),
        },
        { signal },
      );
      const calls = res.output.flatMap((o) => (o.type === "function_call" ? [{ call_id: o.call_id, name: o.name, arguments: o.arguments }] : []));
      return {
        calls,
        text: res.output_text ?? "",
        model: res.model,
        replay: res.output,
        usage: {
          input_tokens: res.usage?.input_tokens ?? 0,
          cached_tokens: res.usage?.input_tokens_details?.cached_tokens ?? 0,
          output_tokens: res.usage?.output_tokens ?? 0,
        },
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (signal.aborted) throw new LlmError("The turn ran out of time", "timeout");
      throw new LlmError(err instanceof Error ? err.message : String(err), classifyError(err));
    }
  },
};
