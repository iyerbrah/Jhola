import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { CartSchema, PlanSchema, type Cart, type Plan } from "./schema";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type LlmUsage = { input_tokens: number; cached_tokens: number; output_tokens: number };

export type LlmResult<T> = { output: T; usage: LlmUsage; model: string };

type CallArgs = { instructions: string; messages: ChatMessage[] };
type RepairArgs = CallArgs & { /** True when the fix needs sums (budget, item count): let the model think. */ needsMath?: boolean };

/** The two calls the pipeline makes. Tests pass a fake with the same shape. */
export type LlmClient = {
  plan: (args: CallArgs) => Promise<LlmResult<Plan>>;
  cart: (args: CallArgs) => Promise<LlmResult<Cart>>;
  /** Same output as cart. Thinks only when needsMath is set (budget or item-count fixes). */
  repairCart: (args: RepairArgs) => Promise<LlmResult<Cart>>;
};

/** Thrown when the provider fails or returns output we can't parse. The API maps it to 502. */
export class LlmError extends Error {}

type Effort = "none" | "low" | "medium" | "high";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new LlmError("OPENAI_API_KEY is not set");
  // A normal call takes 1-5 s. buildCarts retries once itself, so the SDK doesn't.
  client ??= new OpenAI({ timeout: 12_000, maxRetries: 0 });
  return client;
}

export function modelName(): string {
  return process.env.LLM_MODEL || "gpt-5.4-mini";
}

function isReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/.test(model);
}

async function structuredCall<S extends z.ZodType>(
  schema: S,
  name: string,
  effort: Effort,
  { instructions, messages }: CallArgs,
): Promise<LlmResult<z.infer<S>>> {
  const model = modelName();
  try {
    const response = await getClient().responses.parse({
      model,
      instructions,
      input: messages,
      text: { format: zodTextFormat(schema, name) },
      max_output_tokens: 3000,
      // Same key for every call, so the long rules + catalog prefix stays cached.
      prompt_cache_key: "ai-cart-builder-v2",
      // Optional: OpenAI's faster, pricier tiers (e.g. "priority"). Unset = the standard tier.
      ...(process.env.LLM_SERVICE_TIER ? { service_tier: process.env.LLM_SERVICE_TIER as "priority" } : {}),
      ...(isReasoningModel(model) ? { reasoning: { effort } } : {}),
    });
    const output = response.output_parsed;
    if (!output) throw new LlmError(`No parsable ${name} output (status: ${response.status})`);
    return {
      output: output as z.infer<S>,
      model: response.model,
      usage: {
        input_tokens: response.usage?.input_tokens ?? 0,
        cached_tokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
      },
    };
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw new LlmError(err instanceof Error ? err.message : String(err));
  }
}

const effort = (value: string | undefined, fallback: Effort) => (value || fallback) as Effort;

/**
 * No call "thinks" (reasoning effort none): evals showed thinking added 2-5 s per call
 * without better carts. Code does the parts that need care: it checks every rule,
 * does all sums and fits over-budget carts itself before any repair call.
 * The one exception: a repair that must fix a budget or item count thinks a little.
 */
export const openAiClient: LlmClient = {
  plan: (args) => structuredCall(PlanSchema, "plan", effort(process.env.LLM_PLAN_EFFORT, "none"), args),
  cart: (args) => structuredCall(CartSchema, "cart", effort(process.env.LLM_CART_EFFORT, "none"), args),
  repairCart: ({ needsMath, ...args }) =>
    structuredCall(CartSchema, "cart", needsMath ? "low" : effort(process.env.LLM_REPAIR_EFFORT, "none"), args),
};
