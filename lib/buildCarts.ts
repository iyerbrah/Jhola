import { fitToBudget } from "./budget";
import { diversify } from "./diversify";
import { tidyCart } from "./tidy";
import { catalog, catalogIndex, indexCatalog, type CatalogIndex } from "./catalog";
import { LlmError, openAiClient, type ChatMessage, type LlmClient, type LlmResult, type LlmUsage } from "./llm";
import { markPantryOptional } from "./pantry";
import { priceVariants } from "./price";
import { buildInstructions, cartMessage, cartRepairMessage, planMessage } from "./prompt";
import type { BuildCartsResponse, Cart, LlmOutput, LlmVariant, Product } from "./schema";
import { checkOutput, salvage } from "./validate";

export type BuildCartsDeps = { llm?: LlmClient; products?: Product[]; instructions?: string };

let cachedInstructions: string | null = null;

const NO_CARTS_MESSAGE = "Sorry, I couldn't build a cart that fits this request. Try rephrasing it or loosening the budget.";

/**
 * query -> plan (1 call) -> 3 carts (3 calls in parallel) -> validate
 * -> repair only the carts that broke a rule (in parallel, once) -> price.
 * Throws LlmError if the provider fails twice on the plan, or on every cart.
 */
export async function buildCarts(query: string, deps: BuildCartsDeps = {}): Promise<BuildCartsResponse> {
  const started = Date.now();
  const llm = deps.llm ?? openAiClient;
  const products = deps.products ?? catalog;
  const index: CatalogIndex = deps.products ? indexCatalog(deps.products) : catalogIndex;
  const instructions = deps.instructions ?? (cachedInstructions ??= buildInstructions());

  const usage: LlmUsage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
  /** How long each step took, for finding slow spots. */
  const steps = { plan: 0, carts: 0, repair: 0 };
  let model = "";
  const track = async <T>(call: Promise<LlmResult<T>>): Promise<T> => {
    const res = await call;
    usage.input_tokens += res.usage.input_tokens;
    usage.cached_tokens += res.usage.cached_tokens;
    usage.output_tokens += res.usage.output_tokens;
    model = res.model;
    return res.output;
  };
  // A provider failure (timeout, 5xx, unparsable output) gets one retry.
  const withRetry = async <T>(fn: () => Promise<LlmResult<T>>): Promise<T> => {
    try {
      return await track(fn());
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      return await track(fn());
    }
  };
  const user = (content: string): ChatMessage[] => [{ role: "user", content }];

  const respond = (out: Omit<BuildCartsResponse, "meta" | "variants"> & { variants: LlmVariant[] }, repaired: boolean): BuildCartsResponse => ({
    status: out.status,
    message: out.message,
    assumptions: out.assumptions,
    suggestions: out.status === "cannot_fulfil" ? out.suggestions.slice(0, 3) : [],
    // Cheapest cart first, so the cards read Budget -> Premium.
    variants: priceVariants(out.variants, index).sort((a, b) => a.total - b.total),
    meta: { latency_ms: Date.now() - started, model, repaired, ...usage, steps_ms: { ...steps } },
  });

  // 1. Plan
  const plan = await withRetry(() => llm.plan({ instructions, messages: user(planMessage(query)) }));
  steps.plan = Date.now() - started;
  if (plan.status === "cannot_fulfil" || plan.variants.length === 0) {
    return respond({ ...plan, status: "cannot_fulfil", message: plan.message || NO_CARTS_MESSAGE, variants: [] }, false);
  }
  const planned = plan.variants.slice(0, 3);

  // 2. Carts, in parallel. A cart whose call fails twice is dropped.
  const cartMessages = planned.map((v, i) => user(cartMessage(query, plan, v, i)));
  const carts: (Cart | null)[] = await Promise.all(
    cartMessages.map((messages) => withRetry(() => llm.cart({ instructions, messages })).catch((err) => {
      if (err instanceof LlmError) return null;
      throw err;
    })),
  );
  if (carts.every((c) => c === null)) throw new LlmError("Every cart call failed");

  let variants: LlmVariant[] = [];
  const messagesFor: ChatMessage[][] = [];
  carts.forEach((cart, i) => {
    if (!cart) return;
    variants.push({ name: planned[i].name, reason: planned[i].reason, ...cart });
    messagesFor.push(cartMessages[i]);
  });

  // 3. Rules code can apply itself (instant, no LLM call):
  //    duplicate lines merge, out-of-stock picks swap to a twin, pantry staples are optional,
  //    over-budget carts swap to cheaper packs,
  //    and carts that are too alike swap shared items for other brands.
  variants = variants.map((v) => markPantryOptional(tidyCart(v, index, products), query, index));
  const budget = plan.constraints.budget_inr;
  if (budget != null) {
    variants = variants.map((v) => fitToBudget(v, budget, index, products) ?? v);
  }
  // Carts too alike (e.g. same onion, paneer and spices in two carts)? Swap shared items for other brands.
  variants = diversify(variants, index, products, budget ?? null);

  // 4. Validate; repair only the carts with problems, in parallel, once.
  let out: LlmOutput = { ...plan, variants };
  let check = checkOutput(out, index);
  const failing = check.perVariant.flatMap((errors, i) => (errors.length ? [i] : []));
  const repaired = failing.length > 0;
  const debug = (label: string) => {
    if (process.env.DEBUG_CARTS) console.error(`[buildCarts] ${label}:`, JSON.stringify(check));
  };
  steps.carts = Date.now() - started - steps.plan;
  if (repaired) {
    const repairStarted = Date.now();
    debug("before repair");
    const fixes = await Promise.all(
      failing.map((i) => {
        const { items, model_total_inr } = variants[i];
        const messages = [...messagesFor[i], ...user(cartRepairMessage({ items, model_total_inr }, check.perVariant[i], index))];
        const needsMath = check.perVariant[i].some((e) => /budget|needs exactly/.test(e));
        return track(llm.repairCart({ instructions, messages, needsMath })).catch((err) => {
          if (err instanceof LlmError) return null; // keep the first cart and salvage below
          throw err;
        });
      }),
    );
    variants = variants.map((v, i) => {
      const fix = fixes[failing.indexOf(i)];
      return fix ? { name: v.name, reason: v.reason, ...fix } : v;
    });
    out = { ...plan, variants };
    check = checkOutput(out, index);
    debug("after repair");
    steps.repair = Date.now() - repairStarted;
  }

  // 5. Still broken: drop bad items and carts. Only say "partial" if something was removed.
  let { status, message } = out;
  const errors = [...check.global, ...check.perVariant.flat()];
  const lostCarts = planned.length - variants.length;
  if (errors.length || lostCarts > 0) {
    const saved = errors.length ? salvage(out, index) : { variants, dropped: 0 };
    out = { ...out, variants: saved.variants };
    const missing = 3 - saved.variants.length;
    if (saved.variants.length === 0) {
      status = "cannot_fulfil";
      message = message || NO_CARTS_MESSAGE;
    } else if (missing > 0 || saved.dropped > 0) {
      status = "partial";
      const parts = [
        missing > 0 ? `Showing ${saved.variants.length} of 3 carts` : "",
        saved.dropped ? `removed ${saved.dropped} item(s) that weren't available` : "",
      ].filter(Boolean);
      const note = parts.join("; ").replace(/^./, (c) => c.toUpperCase()) + ".";
      message = message ? `${message} ${note}` : note;
    }
  }

  return respond({ ...out, status, message }, repaired);
}
