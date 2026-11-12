import OpenAI from "openai";

export type LlmUsage = { input_tokens: number; cached_tokens: number; output_tokens: number };

/** Why a call failed. Safe to show: it never contains the key or the prompt. */
export type LlmErrorKind = "missing_key" | "bad_key" | "quota" | "timeout" | "bad_output" | "provider";

/** Thrown when the provider fails or returns output we can't parse. The API maps it to 502. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind = "provider",
  ) {
    super(message);
  }
}

/** Sort a provider error into a kind, from its HTTP status and message. */
export function classifyError(err: unknown): LlmErrorKind {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (status === 401 || status === 403 || msg.includes("api key")) return "bad_key";
  if (status === 429 || msg.includes("quota")) return "quota";
  if (msg.includes("timed out") || msg.includes("timeout")) return "timeout";
  return "provider";
}

let client: OpenAI | null = null;

/** Who serves the model: "openrouter" (default) or "openai" directly. OpenRouter speaks the same API at another address. */
export function isOpenRouter(): boolean {
  return (process.env.LLM_PROVIDER || "openrouter").trim().toLowerCase() === "openrouter";
}

/** OpenAI-only request options (prompt caching, service tier). Other providers get none. */
export function openAiOnly<T extends object>(options: T): T | Record<string, never> {
  return isOpenRouter() ? {} : options;
}

/** The env var that holds the key for the chosen provider. */
export function apiKeyName(): "OPENAI_API_KEY" | "OPENROUTER_API_KEY" {
  return isOpenRouter() ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
}

/** The shared client (lib/chat/model.ts). */
export function getClient(): OpenAI {
  const keyName = apiKeyName();
  const apiKey = process.env[keyName];
  if (!apiKey) throw new LlmError(`${keyName} is not set`, "missing_key");
  // A normal call takes 1-5 s. The agent loop retries once itself, so the SDK doesn't.
  client ??= new OpenAI({
    apiKey,
    timeout: Number(process.env.LLM_TIMEOUT_MS) || 12_000,
    maxRetries: 0,
    ...(isOpenRouter() ? { baseURL: "https://openrouter.ai/api/v1" } : {}),
  });
  return client;
}

/**
 * The model the agent runs on: gpt-5.4-mini, through OpenRouter by default.
 * Each provider has its own model setting, so switching LLM_PROVIDER is the only change needed.
 */
export function modelName(): string {
  if (isOpenRouter()) return process.env.OPENROUTER_MODEL || "openai/gpt-5.4-mini";
  return process.env.OPENAI_MODEL || "gpt-5.4-mini";
}

/**
 * Models that take a reasoning effort. On OpenRouter it's always sent: its models think by
 * default unless told "none", and the thinking alone can use up max_output_tokens.
 */
export function isReasoningModel(model: string): boolean {
  return isOpenRouter() || /^(gpt-5|gpt-6|o\d)/.test(model);
}

/** Token counts from a Responses API reply, with 0 for anything the provider left out. */
export function toUsage(u: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | null | undefined): LlmUsage {
  return {
    input_tokens: u?.input_tokens ?? 0,
    cached_tokens: u?.input_tokens_details?.cached_tokens ?? 0,
    output_tokens: u?.output_tokens ?? 0,
  };
}
