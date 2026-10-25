/**
 * USD prices per 1M tokens, from OpenAI's pricing page (developers.openai.com/api/docs/pricing),
 * checked Oct 25, 2026. Update this table if you change LLM_MODEL or prices change.
 */
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
};

type Usage = { input_tokens: number; cached_tokens: number; output_tokens: number };

/** Price row for a model name, including dated names like "gpt-5.4-mini-2026-03-17". */
export function pricesFor(model: string) {
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  return key ? PRICES[key] : null;
}

/** Cost in USD, or null if the model's price isn't in the table. Cached input is billed at its own rate. */
export function costUsd(model: string, u: Usage): number | null {
  const p = pricesFor(model);
  if (!p) return null;
  const uncached = Math.max(0, u.input_tokens - u.cached_tokens);
  return (uncached * p.input + u.cached_tokens * p.cached + u.output_tokens * p.output) / 1_000_000;
}
