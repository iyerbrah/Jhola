/**
 * The cart editor agent's tools: their JSON schemas (sent to the model) and the code that runs them.
 *
 * The model only ever asks; code decides. Every argument is validated again here, every edit goes
 * through the same functions the UI's buttons use (lib/cartState.ts), and prices always come from
 * the catalog. Errors are written for the model to act on: they say what went wrong and what to do.
 */
import { z } from "zod";
import type { CatalogIndex } from "../catalog";
import { fitToBudget } from "../budget";
import { cartTotal, MAX_QTY, removeItem, setQty, swapItem } from "../cartState";
import { isSameKind } from "../kind";
import { DIET_LABELS, DIETS } from "../requirements";
import { matchesKind } from "../validate";
import { CATEGORIES, packLabel, type LlmVariant, type Product } from "../schema";
import { checkCart, MAX_ITEMS, toCartItem, type AgentCart } from "./carts";
import type { CatalogSearch, SearchHit } from "./search";

/** What a turn works on. Cart numbers the model sees are 1-based; indexes here are 0-based. */
export type AgentState = {
  carts: AgentCart[];
  /** The cart the shopper is looking at. */
  active: number;
  /** Bumped on every change, so a repeated call can be told apart from one after an edit. */
  version: number;
  /** Carts changed this turn (items or requirements). Only these must pass every rule to finish. */
  touched: Set<number>;
  /** Carts this turn may change (see lib/agent/scope.ts). Omitted = all. */
  scope?: Set<number>;
  /**
   * Rupee amounts the agent has been shown this turn (carts, tool results, the shopper's message).
   * finish refuses a reply with any other amount, so it can't state a made-up total. Omitted = not checked.
   */
  amounts?: Set<number>;
};

/** Every "₹1,240" in a text, as numbers. */
export function amountsIn(text: string): number[] {
  return [...text.matchAll(/₹\s?(\d[\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter(Number.isFinite);
}

export type ToolDeps = { index: CatalogIndex; products: Product[]; search: CatalogSearch };

export type ToolResult = { ok: boolean; output: string; finished?: { reply: string } };

export const MAX_REPLY = 400;

// ---------- Schemas the model sees (strict: every field required, null where "not given") ----------

const cartArg = { type: "integer", description: "Cart number, 1 to 3." };
const productArg = { type: "string", description: "Product ID from the carts or from search_catalog, like p214." };
const qtyArg = { type: "integer", description: `Number of packs, 1 to ${MAX_QTY}.` };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
/** Every editing tool asks whether the shopper's request will be complete once this step has run. */
const doneArg = {
  type: "boolean",
  description: "true if, once this step's calls have run, the shopper's whole request is done. Code then checks the rules and ends the turn for you, so you don't need finish.",
};
const editObj = (properties: Record<string, unknown>) => obj({ ...properties, done: doneArg });

export const TOOL_SPECS = [
  {
    name: "search_catalog",
    description: "Find in-stock products. Returns up to 8, best match first, then cheapest. Search for what the shopper means (\"paneer\", \"dark chocolate\"), not whole sentences.",
    parameters: obj({
      text: { type: "string", description: "What to look for, in a few words." },
      diet: { type: ["string", "null"], enum: [...DIETS, null], description: "Only products with this diet tag." },
      max_price: { type: ["integer", "null"], description: "Only products at or under this price per pack, in rupees." },
      category: { type: ["string", "null"], enum: [...CATEGORIES, null], description: "Only this category." },
    }),
  },
  {
    name: "get_product",
    description: "One product's details: name, brand, pack, price, kind, diet tags, stock.",
    parameters: obj({ product_id: productArg }),
  },
  {
    name: "add_item",
    description: "Add a product to a cart as a required line.",
    parameters: editObj({ cart: cartArg, product_id: productArg, qty: qtyArg }),
  },
  {
    name: "remove_item",
    description: "Remove a product's line from a cart.",
    parameters: editObj({ cart: cartArg, product_id: productArg }),
  },
  {
    name: "swap_item",
    description: "Replace one product in a cart with another. Code works out the packs for about the same amount (900 g of chicken → 5 × 200 g of paneer) when both are sold by weight, volume or pieces alike.",
    parameters: editObj({ cart: cartArg, product_id: { ...productArg, description: "The product in the cart now." }, new_product_id: { ...productArg, description: "The product to put in its place." } }),
  },
  {
    name: "set_qty",
    description: "Change how many packs of a product a cart has.",
    parameters: editObj({ cart: cartArg, product_id: productArg, qty: qtyArg }),
  },
  {
    name: "cheapen",
    description:
      "Let code make a cart cheaper with the smallest changes that are enough: cheaper packs or brands of the same kind, or one pack fewer. It never removes a product and keeps the cart's diet. With budget_inr it reaches that total and records it as the cart's budget or, if it can't, changes nothing and says the lowest total it can reach. With null it cuts about 15%.",
    parameters: editObj({ cart: cartArg, budget_inr: { type: ["integer", "null"], description: "Target total in rupees, or null for about 15% cheaper." } }),
  },
  {
    name: "fit_diet",
    description:
      "Let code swap every item in a cart that breaks the cart's diet for the closest in-stock product of the same kind that fits it (same quantity). Lists the items with no same-kind option, which you then swap for something else or remove. Set the diet with set_requirements first (it can be in the same step, before this call).",
    parameters: editObj({ cart: cartArg }),
  },
  {
    name: "set_requirements",
    description:
      "Record a new requirement the shopper stated for a cart, so it's checked from now on. Call it before editing for a diet or a budget.",
    parameters: editObj({
      cart: cartArg,
      diet: { type: ["string", "null"], enum: [...DIETS, "any", null], description: "New diet; \"any\" removes the diet; null leaves it as it is." },
      budget_inr: { type: ["integer", "null"], description: "New budget in rupees; 0 removes the budget; null leaves it as it is." },
      drop_must_include: {
        type: "array",
        items: obj({
          kind: { type: "string", description: "A named ingredient the cart requires now, e.g. chicken." },
          replaced_by: {
            type: ["string", "null"],
            description: "What replaces it in the dish, as a kind of product (paneer, mushroom, soya chunks, mixed vegetables). The cart must then contain it. null only if the shopper already has it.",
          },
        }),
        description: "Named ingredients the cart no longer has to contain, because the shopper asked for something else. Empty to keep all.",
      },
    }),
  },
  {
    name: "check_rules",
    description: "List everything a cart currently breaks (stock, quantities, budget, diet, named ingredients, item count).",
    parameters: obj({ cart: cartArg }),
  },
  {
    name: "finish",
    description: "End the turn with a short reply to the shopper. Refused while a cart you changed breaks a rule.",
    parameters: obj({ reply: { type: "string", description: "One or two short sentences: what changed and the new total, or the answer to their question." } }),
  },
] as const;

export type ToolName = (typeof TOOL_SPECS)[number]["name"];

// ---------- The same rules, enforced on our side ----------

const cart = z.number().int();
/** Not used by the tool itself: the loop reads it (see runAgentTurn). Missing = false. */
const done = z.boolean().default(false);
const pid = z.string().max(12);
const qty = z.number().int();
const ARGS = {
  search_catalog: z.object({
    text: z.string().max(80),
    diet: z.enum(DIETS).nullable(),
    max_price: z.number().int().positive().nullable(),
    category: z.enum(CATEGORIES).nullable(),
  }),
  get_product: z.object({ product_id: pid }),
  add_item: z.object({ cart, product_id: pid, qty, done }),
  remove_item: z.object({ cart, product_id: pid, done }),
  swap_item: z.object({ cart, product_id: pid, new_product_id: pid, done }),
  set_qty: z.object({ cart, product_id: pid, qty, done }),
  set_requirements: z.object({
    cart,
    diet: z.enum([...DIETS, "any"]).nullable(),
    budget_inr: z.number().int().min(0).max(1_000_000).nullable(),
    drop_must_include: z.array(z.object({ kind: z.string().max(40), replaced_by: z.string().max(40).nullable() })).max(5),
    done,
  }),
  cheapen: z.object({ cart, budget_inr: z.number().int().positive().nullable(), done }),
  fit_diet: z.object({ cart, done }),
  check_rules: z.object({ cart }),
  finish: z.object({ reply: z.string() }),
} satisfies Record<ToolName, z.ZodType>;

const ok = (output: string): ToolResult => ({ ok: true, output });
const fail = (output: string): ToolResult => ({ ok: false, output: `Error: ${output}` });

// ---------- What the model reads ----------

export function hitLine(h: SearchHit): string {
  return [h.id, h.name, h.brand, h.pack, `₹${h.price}`, h.sub_category, h.tags.join(",") || "-", h.in_stock ? "in stock" : "OUT OF STOCK"].join(" | ");
}

const productLine = (p: Product) => hitLine({ id: p.id, name: p.name, brand: p.brand, pack: packLabel(p), price: p.price, sub_category: p.sub_category, tags: p.tags, in_stock: p.in_stock });

/** A cart as compact text: requirements, total and one line per item with its diet tags. */
export function cartView(c: AgentCart, i: number, index: CatalogIndex, active?: number, editable?: boolean): string {
  const r = c.requirements;
  const reqs = [
    `diet: ${r.diet ? DIET_LABELS[r.diet] : "none"}`,
    `budget: ${r.budget_inr != null ? `₹${r.budget_inr}` : "none"}`,
    `must include: ${r.must_include.length ? r.must_include.join(", ") : "none"}`,
    ...(r.item_count != null ? [`exactly ${r.item_count} ${r.item_kind ?? "items"}`] : []),
  ].join("; ");
  const lines = c.items.map((it) => {
    const p = index.get(it.product_id);
    const tags = p?.tags.join(",") || "-";
    const flags = [it.optional ? (it.included ? "optional, ticked" : "optional, not ticked") : "", p && !p.in_stock ? "OUT OF STOCK" : ""].filter(Boolean).join(", ");
    return `- ${it.product_id} | ${it.name} | ${it.brand} | ${it.pack_label} | ₹${it.price} × ${it.qty} = ₹${it.line_total} | ${it.sub_category} | ${tags}${flags ? ` | ${flags}` : ""}`;
  });
  const notes = [active === i ? "the shopper is looking at this one" : "", editable === true ? "you can change it" : editable === false ? "look only: don't change it" : ""].filter(Boolean);
  const head = `Cart ${i + 1} "${c.name}"${notes.length ? ` (${notes.join("; ")})` : ""}: total ₹${cartTotal(c)}`;
  return [head, `Requirements: ${reqs}`, ...(lines.length ? lines : ["(empty)"])].join("\n");
}

// ---------- Running a tool ----------

function cartIndex(n: number, state: AgentState): number | ToolResult {
  if (n < 1 || n > state.carts.length) return fail(`there ${state.carts.length === 1 ? "is only cart 1" : `are only carts 1 to ${state.carts.length}`}.`);
  return n - 1;
}

const cartList = (s: Set<number>) => [...s].sort().map((i) => i + 1).join(" and ");

/** A cart this turn may change: in range and in scope. */
function editableCart(n: number, state: AgentState): number | ToolResult {
  const i = cartIndex(n, state);
  if (isResult(i)) return i;
  if (state.scope && !state.scope.has(i)) {
    return fail(`the shopper didn't ask to change cart ${n}. Change only cart ${cartList(state.scope)}; they'll name another cart if they want it changed.`);
  }
  return i;
}

function qtyError(q: number): ToolResult | null {
  return q < 1 || q > MAX_QTY ? fail(`qty must be a whole number from 1 to ${MAX_QTY}.`) : null;
}

/** In-stock products that can stand in for an unavailable one, closest price first. */
function twins(p: Product, products: Product[], inCart: Set<string>): Product[] {
  return products
    .filter((alt) => alt.in_stock && alt.id !== p.id && !inCart.has(alt.id) && isSameKind(p, alt))
    .sort((a, b) => Math.abs(a.price - p.price) - Math.abs(b.price - p.price))
    .slice(0, 2);
}

/** Looks up a product the model wants to put in a cart, with an error it can act on. */
function stocked(id: string, c: AgentCart, deps: ToolDeps): Product | ToolResult {
  const p = deps.index.get(id);
  if (!p) return fail(`${id} isn't in the catalog. Use search_catalog to find real product IDs.`);
  if (!p.in_stock) {
    const alts = twins(p, deps.products, new Set(c.items.map((it) => it.product_id)));
    return fail(`${id} (${p.name}) is out of stock.${alts.length ? ` Closest in stock:\n${alts.map(productLine).join("\n")}` : " Search for another."}`);
  }
  return p;
}

function changed(state: AgentState, i: number, cartNow: AgentCart, deps: ToolDeps, what: string): ToolResult {
  state.carts[i] = cartNow;
  state.version++;
  state.touched.add(i);
  return ok(`${what}\n${cartView(cartNow, i, deps.index)}`);
}

const isResult = (x: unknown): x is ToolResult => typeof x === "object" && x !== null && "output" in x;

/**
 * Packs of `next` that hold about the same amount as `qty` packs of `prev` (900 g of chicken ->
 * 5 × 200 g of paneer), or null when they're sold in different units (eggs by the piece).
 */
export function packsForSameAmount(prev: Product, qty: number, next: Product): number | null {
  if (prev.unit !== next.unit) return null;
  const packs = Math.ceil((qty * prev.pack_size) / next.pack_size - 0.05);
  return Math.min(MAX_QTY, Math.max(1, packs));
}

/** Swaps a line for another product, with packs recomputed to keep about the same amount. */
function swapKeepingAmount(c: AgentCart, prev: Product, qty: number, next: Product): { cart: AgentCart; qty: number; sameUnit: boolean } {
  const swapped = swapItem(c, prev.id, next);
  const packs = packsForSameAmount(prev, qty, next);
  return packs == null ? { cart: swapped, qty, sameUnit: false } : { cart: setQty(swapped, next.id, packs), qty: packs, sameUnit: true };
}

const amount = (p: Product, qty: number) => `${qty} × ${packLabel(p)}`;

/**
 * The cart builder's own budget fitting (lib/budget.ts) run on an edited cart: ordered lines can be
 * swapped for cheaper packs of the same kind or lose a pack; unticked optional lines are left alone.
 * Swaps only consider products with the cart's diet. Returns null if the budget can't be reached.
 */
export function fitCart(c: AgentCart, budget: number, deps: ToolDeps): AgentCart | null {
  const diet = c.requirements.diet;
  const products = diet ? deps.products.filter((p) => p.tags.includes(diet)) : deps.products;
  const ordered = c.items.map((it, i) => ({ it, i })).filter(({ it }) => it.included);
  const variant: LlmVariant = {
    name: c.name,
    reason: c.reason,
    model_total_inr: 0,
    items: ordered.map(({ it }) => ({ product_id: it.product_id, need: 0, qty: it.qty, optional: false, note: "" })),
  };
  const fitted = fitToBudget(variant, budget, deps.index, products);
  if (!fitted) return null;
  const items = [...c.items];
  ordered.forEach(({ it, i }, k) => {
    const next = fitted.items[k];
    const p = deps.index.get(next.product_id);
    if (!p) return;
    items[i] = next.product_id === it.product_id ? { ...it, qty: next.qty, line_total: it.price * next.qty } : toCartItem(p, next.qty, it.optional, it.included, it.note);
  });
  return { ...c, items };
}

/**
 * Swaps each ordered item without the cart's diet tag for the in-stock product of the same kind that
 * has it, closest in pack size, then price. Returns the new cart and the items with no such product.
 */
export function fitDiet(c: AgentCart, deps: ToolDeps): { cart: AgentCart; swapped: [Product, Product][]; left: Product[] } {
  const diet = c.requirements.diet;
  let cart = c;
  const swapped: [Product, Product][] = [];
  const left: Product[] = [];
  if (!diet) return { cart, swapped, left };
  for (const it of c.items) {
    const p = deps.index.get(it.product_id);
    if (!it.included || !p || p.tags.includes(diet)) continue;
    const inCart = new Set(cart.items.map((x) => x.product_id));
    const alt = deps.products
      .filter((x) => x.in_stock && !inCart.has(x.id) && x.tags.includes(diet) && isSameKind(p, x))
      .sort((a, b) => Math.abs(Math.log(a.pack_size / p.pack_size)) - Math.abs(Math.log(b.pack_size / p.pack_size)) || Math.abs(a.price - p.price) - Math.abs(b.price - p.price))[0];
    if (alt) {
      cart = swapKeepingAmount(cart, p, it.qty, alt).cart;
      swapped.push([p, alt]);
    } else left.push(p);
  }
  return { cart, swapped, left };
}

/** The lowest total fitCart can reach, trying targets from 95% down to 30% of the current total. */
function lowestFit(c: AgentCart, deps: ToolDeps): number {
  const total = cartTotal(c);
  let lowest = total;
  for (let f = 0.95; f >= 0.3; f -= 0.05) {
    const fitted = fitCart(c, Math.floor(total * f), deps);
    if (!fitted) break;
    lowest = cartTotal(fitted);
  }
  return lowest;
}

/** Runs one tool call. Never throws for bad input: problems come back as an error result for the model. */
export async function runTool(name: string, rawArgs: string, state: AgentState, deps: ToolDeps): Promise<ToolResult> {
  if (!(name in ARGS)) return fail(`there is no tool called ${name}.`);
  let json: unknown;
  try {
    json = JSON.parse(rawArgs);
  } catch {
    return fail("the arguments weren't valid JSON.");
  }
  const parsed = ARGS[name as ToolName].safeParse(json);
  if (!parsed.success) return fail(`bad arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}.`);
  const args: unknown = parsed.data;

  switch (name as ToolName) {
    case "search_catalog": {
      const a = args as z.infer<typeof ARGS.search_catalog>;
      const hits = await deps.search.search({ text: a.text, diet: a.diet, max_price: a.max_price, category: a.category });
      return ok(hits.length ? hits.map(hitLine).join("\n") : `No in-stock products match "${a.text}" with those filters. Try other words or fewer filters.`);
    }
    case "get_product": {
      const p = deps.index.get((args as z.infer<typeof ARGS.get_product>).product_id);
      return p ? ok(productLine(p)) : fail(`that product isn't in the catalog.`);
    }
    case "add_item": {
      const a = args as z.infer<typeof ARGS.add_item>;
      const i = editableCart(a.cart, state);
      if (isResult(i)) return i;
      const c = state.carts[i];
      const bad = qtyError(a.qty);
      if (bad) return bad;
      const existing = c.items.find((it) => it.product_id === a.product_id);
      if (existing) return fail(`${a.product_id} is already in cart ${a.cart} with qty ${existing.qty}. Use set_qty to change it.`);
      if (c.items.length >= MAX_ITEMS) return fail(`cart ${a.cart} already has ${MAX_ITEMS} lines; remove something first.`);
      const p = stocked(a.product_id, c, deps);
      if (isResult(p)) return p;
      return changed(state, i, { ...c, items: [...c.items, toCartItem(p, a.qty, false, true)] }, deps, `Added ${p.name} × ${a.qty}.`);
    }
    case "remove_item": {
      const a = args as z.infer<typeof ARGS.remove_item>;
      const i = editableCart(a.cart, state);
      if (isResult(i)) return i;
      const c = state.carts[i];
      const it = c.items.find((x) => x.product_id === a.product_id);
      if (!it) return fail(`${a.product_id} isn't in cart ${a.cart}.`);
      return changed(state, i, removeItem(c, a.product_id), deps, `Removed ${it.name}.`);
    }
    case "swap_item": {
      const a = args as z.infer<typeof ARGS.swap_item>;
      const i = editableCart(a.cart, state);
      if (isResult(i)) return i;
      const c = state.carts[i];
      const it = c.items.find((x) => x.product_id === a.product_id);
      if (!it) return fail(`${a.product_id} isn't in cart ${a.cart}.`);
      if (c.items.some((x) => x.product_id === a.new_product_id)) {
        return fail(`${a.new_product_id} is already in cart ${a.cart}. Remove ${a.product_id} instead, or set_qty on ${a.new_product_id}.`);
      }
      const p = stocked(a.new_product_id, c, deps);
      if (isResult(p)) return p;
      const prev = deps.index.get(a.product_id)!;
      const s = swapKeepingAmount(c, prev, it.qty, p);
      const note = s.sameUnit
        ? `${amount(prev, it.qty)} → ${amount(p, s.qty)}, about the same amount.`
        : `kept ${s.qty} pack${s.qty === 1 ? "" : "s"}: ${prev.unit} and ${p.unit} can't be compared, so use set_qty if the amount should change.`;
      return changed(state, i, s.cart, deps, `Swapped ${it.name} for ${p.name}: ${note}`);
    }
    case "set_qty": {
      const a = args as z.infer<typeof ARGS.set_qty>;
      const i = editableCart(a.cart, state);
      if (isResult(i)) return i;
      const c = state.carts[i];
      const bad = qtyError(a.qty);
      if (bad) return bad;
      const it = c.items.find((x) => x.product_id === a.product_id);
      if (!it) return fail(`${a.product_id} isn't in cart ${a.cart}. Use add_item to add it.`);
      return changed(state, i, setQty(c, a.product_id, a.qty), deps, `Set ${it.name} to ${a.qty}.`);
    }
    case "cheapen": {
      const a = args as z.infer<typeof ARGS.cheapen>;
      const i = editableCart(a.cart, state);
      if (isResult(i)) return i;
      const c = state.carts[i];
      const before = cartTotal(c);
      if (a.budget_inr != null) {
        if (before <= a.budget_inr) return ok(`Cart ${a.cart} is already ₹${before}, at or under ₹${a.budget_inr}. Nothing changed.`);
        const fitted = fitCart(c, a.budget_inr, deps);
        if (!fitted) {
          const lowest = lowestFit(c, deps);
          return fail(
            `cheaper packs and brands can't get cart ${a.cart} to ₹${a.budget_inr}: the lowest they reach is ₹${lowest}. Nothing changed. Remove items the shopper can do without, or tell them the lowest realistic total.`,
          );
        }
        // The shopper named this budget, so it becomes the cart's requirement too.
        const next = { ...fitted, requirements: { ...fitted.requirements, budget_inr: a.budget_inr } };
        return changed(state, i, next, deps, `Cheaper packs and brands: ₹${before} → ₹${cartTotal(fitted)}. Budget of ₹${a.budget_inr} recorded.`);
      }
      for (const f of [0.85, 0.9, 0.95]) {
        const fitted = fitCart(c, Math.floor(before * f), deps);
        if (fitted) return changed(state, i, fitted, deps, `Cheaper packs and brands: ₹${before} → ₹${cartTotal(fitted)}.`);
      }
      return fail(`there are no cheaper packs or brands for cart ${a.cart}'s items. Nothing changed. To go cheaper, remove extras the dish can do without.`);
    }
    case "fit_diet": {
      const a = args as z.infer<typeof ARGS.fit_diet>;
      const i = editableCart(a.cart, state);
      if (isResult(i)) return i;
      const c = state.carts[i];
      const diet = c.requirements.diet;
      if (!diet) return fail(`cart ${a.cart} has no diet yet. Set it with set_requirements first.`);
      const { cart: next, swapped, left } = fitDiet(c, deps);
      const leftText = left.length
        ? `\nNo same-kind ${DIET_LABELS[diet]} option for: ${left.map((p) => `${p.id} (${p.name})`).join(", ")}. Swap these for something else that fits the dish, or remove them.`
        : "";
      if (!swapped.length) return ok(`Nothing to swap by kind in cart ${a.cart}.${leftText || ` Every ordered item is already ${DIET_LABELS[diet]}.`}`);
      const result = changed(state, i, next, deps, `Swapped for ${DIET_LABELS[diet]}: ${swapped.map(([p, alt]) => `${p.name} → ${alt.name}`).join("; ")}.`);
      return ok(`${result.output}${leftText}`);
    }
    case "set_requirements": {
      const a = args as z.infer<typeof ARGS.set_requirements>;
      const i = editableCart(a.cart, state);
      if (isResult(i)) return i;
      const c = state.carts[i];
      const dropped = a.drop_must_include.map((d) => d.kind);
      const unknown = dropped.filter((k) => !c.requirements.must_include.includes(k));
      if (unknown.length) {
        return fail(`cart ${a.cart} doesn't require ${unknown.join(", ")}. It requires: ${c.requirements.must_include.join(", ") || "nothing by name"}.`);
      }
      const r = { ...c.requirements };
      if (a.diet) r.diet = a.diet === "any" ? null : a.diet;
      if (a.budget_inr != null) r.budget_inr = a.budget_inr === 0 ? null : a.budget_inr;
      // A diet change is never "the shopper already has it": the dish needs a replacement.
      const noReplacement = a.drop_must_include.filter((d) => !d.replaced_by).map((d) => d.kind);
      if (a.diet && a.diet !== "any" && noReplacement.length) {
        return fail(
          `this is a diet change, so the dish needs something in place of ${noReplacement.join(", ")}. Set replaced_by to a ${DIET_LABELS[a.diet]} kind of product (paneer, mushroom, soya chunks, mixed vegetables).`,
        );
      }
      // A replacement becomes the dish's new named ingredient, so finish checks the cart really has it.
      const replacements = a.drop_must_include.flatMap((d) => (d.replaced_by ? [d.replaced_by.trim().toLowerCase()] : []));
      for (const k of replacements) {
        const stocked = deps.products.some((p) => p.in_stock && (!r.diet || p.tags.includes(r.diet)) && matchesKind(p, k));
        if (!stocked) return fail(`no in-stock${r.diet ? ` ${DIET_LABELS[r.diet]}` : ""} product matches "${k}". Search for what to use instead, then name its kind (like paneer).`);
      }
      r.must_include = [...new Set([...r.must_include.filter((k) => !dropped.includes(k)), ...replacements])].slice(0, 5);
      // Remember how much the dropped ingredient was, so its replacement can't be a token amount.
      for (const d of a.drop_must_include) {
        if (!d.replaced_by) continue;
        const was = c.items.flatMap((it) => {
          const p = deps.index.get(it.product_id);
          return it.included && p && matchesKind(p, d.kind) ? [{ p, qty: it.qty }] : [];
        });
        if (!was.length) continue;
        const unit = was[0].p.unit;
        const total = was.filter((w) => w.p.unit === unit).reduce((sum, w) => sum + w.qty * w.p.pack_size, 0);
        const kind = d.replaced_by.trim().toLowerCase();
        // Eggs are counted by the piece and paneer by weight: amounts in different units can't be compared.
        if (!deps.products.some((p) => p.in_stock && p.unit === unit && matchesKind(p, kind))) continue;
        r.min_amounts = [...(r.min_amounts ?? []).filter((m) => m.kind !== kind), { kind, amount: Math.ceil(total / 2), unit }].slice(-5);
      }
      const next = { ...c, requirements: r };
      const problems = checkCart(next, deps.index);
      const result = changed(state, i, next, deps, "Requirements updated.");
      return problems.length ? ok(`${result.output}\nTo fix now:\n${problems.map((p) => `- ${p}`).join("\n")}`) : result;
    }
    case "check_rules": {
      const a = args as z.infer<typeof ARGS.check_rules>;
      const i = cartIndex(a.cart, state);
      if (isResult(i)) return i;
      const problems = checkCart(state.carts[i], deps.index);
      return ok(problems.length ? `Cart ${a.cart} breaks:\n${problems.map((p) => `- ${p}`).join("\n")}` : `Cart ${a.cart} passes every rule.`);
    }
    case "finish": {
      const reply = (args as z.infer<typeof ARGS.finish>).reply.trim().slice(0, MAX_REPLY);
      if (!reply) return fail("the reply is empty.");
      const broken = [...state.touched].sort().flatMap((i) => checkCart(state.carts[i], deps.index).map((p) => `cart ${i + 1}: ${p}`));
      if (broken.length) {
        return fail(
          `can't finish while a cart you changed breaks a rule:\n${broken.map((p) => `- ${p}`).join("\n")}\nFix these. If one truly can't be fixed, change it back and say why in the reply.`,
        );
      }
      if (state.amounts) {
        const known = new Set(state.amounts);
        for (const c of state.carts) {
          known.add(cartTotal(c));
          if (c.requirements.budget_inr != null) known.add(c.requirements.budget_inr);
          for (const it of c.items) known.add(it.price).add(it.line_total);
        }
        const madeUp = [...new Set(amountsIn(reply).filter((n) => !known.has(n)))];
        if (madeUp.length) {
          return fail(
            `your reply mentions ${madeUp.map((n) => `₹${n}`).join(", ")}, which isn't a price or total in the carts or tool results. Use the totals the carts show, or leave amounts out (don't state amounts you worked out yourself).`,
          );
        }
      }
      return { ok: true, output: "Finished.", finished: { reply } };
    }
  }
}

/** A short line for the shopper while a tool runs ("Searching for paneer"). */
export function statusFor(name: string, rawArgs: string, index: CatalogIndex): string | null {
  let a: Record<string, unknown> = {};
  try {
    a = JSON.parse(rawArgs) ?? {};
  } catch {}
  const nameOf = (id: unknown) => (typeof id === "string" && index.get(id)?.name) || "an item";
  switch (name) {
    case "search_catalog":
      return typeof a.text === "string" ? `Searching for ${a.text.slice(0, 40)}` : "Searching";
    case "add_item":
      return `Adding ${nameOf(a.product_id)}`;
    case "remove_item":
      return `Removing ${nameOf(a.product_id)}`;
    case "swap_item":
      return `Swapping ${nameOf(a.product_id)} for ${nameOf(a.new_product_id)}`;
    case "set_qty":
      return `Changing ${nameOf(a.product_id)}`;
    case "set_requirements":
      return "Updating what the cart must meet";
    case "cheapen":
      return "Finding cheaper packs";
    case "fit_diet":
      return "Swapping items to fit the diet";
    case "check_rules":
      return "Checking the cart";
    default:
      return null;
  }
}
