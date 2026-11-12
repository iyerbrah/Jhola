/**
 * The single-cart domain. The agent writes intent (a Brief and Needs); the solver (lib/cart/solve.ts)
 * turns intent into a Cart. Everything the browser sends back is parsed with these schemas, and every
 * product and price in a Cart comes from the catalog.
 */
import { z } from "zod";
import { DIETS } from "../requirements";
import type { Category, Product, Unit } from "../schema";

export const QUALITIES = ["value", "balanced", "premium"] as const;
export type Quality = (typeof QUALITIES)[number];

export const ROLES = ["main", "core", "extra", "pantry"] as const;
export type Role = (typeof ROLES)[number];

export const NEED_UNITS = ["g", "ml", "pcs", "pack"] as const;
export type NeedUnit = (typeof NEED_UNITS)[number];

export const RULE_KINDS = ["exclude_kind", "exclude_word", "exclude_brand", "have"] as const;

/**
 * A standing rule from the shopper. Rules are hard: the solver never picks a product a rule excludes,
 * on this turn or any later one. "have" skips needs the shopper already has.
 */
export const RuleSchema = z.object({
  kind: z.enum(RULE_KINDS),
  /** "onion", "dairy", "Amul", "rice" */
  value: z.string().trim().toLowerCase().min(1).max(40),
  /** How the shopper sees it: "No onions", "No Amul", "Have rice". */
  label: z.string().trim().min(1).max(60),
});
export type Rule = z.infer<typeof RuleSchema>;

export const BriefSchema = z.object({
  /** One line of what the agent understood: "Pasta night, 4 people, vegetarian, around ₹600". */
  summary: z.string().trim().max(140),
  /** Who the amounts are for. null = not about people (cleaning supplies). Per-person needs then assume 2. */
  people: z.number().int().min(1).max(50).nullable(),
  budget_inr: z.number().int().positive().max(1_000_000).nullable(),
  diet: z.enum(DIETS).nullable(),
  quality: z.enum(QUALITIES),
  rules: z.array(RuleSchema).max(12),
  /** What the agent guessed, shown so the shopper can correct it ("Assumed 4 people"). */
  assumptions: z.array(z.string().trim().min(1).max(120)).max(5),
  /**
   * The shopping list the agent wrote before the needs, one line per item with an amount ("paneer 400 g").
   * Kept so later turns see what was planned, and shown while the cart is being built.
   */
  plan: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});
export type Brief = z.infer<typeof BriefSchema>;

export const NeedSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/, "need ids are short lowercase words, like paneer or rice-1"),
  /** Which part of the request it serves ("pasta", "cleaning"), for multi-goal requests. */
  group: z.string().trim().min(1).max(30),
  /** "Penne pasta" */
  label: z.string().trim().min(1).max(60),
  /** The kind of product (a catalog sub_category) that fills it, e.g. "pasta". */
  kind: z.string().trim().toLowerCase().min(1).max(40),
  /** How much: grams, ml or pieces, or a number of packs when unit is "pack". */
  amount: z.number().positive().max(100_000),
  unit: z.enum(NEED_UNITS),
  /** true = amount is for one person; the solver multiplies it by the Brief's people. */
  per_person: z.boolean(),
  /** main: the dish itself (never dropped). core: needed. extra: nice to have (dropped first for a budget). pantry: most kitchens have it. */
  role: z.enum(ROLES),
  /** Counted only when ticked. Pantry items and suggestions start unticked. */
  ticked: z.boolean(),
  /** N different products of this kind ("4 different dark chocolates"). null = one product. */
  count: z.number().int().min(2).max(10).nullable(),
  /** Words that pick within the kind: "curry cut", "70% dark", "whole wheat". */
  prefer: z.string().trim().max(60).nullable(),
  /** Why it's in the cart, a few words: "for the sauce". */
  why: z.string().trim().max(60),
  /** "guess" when the agent assumed the amount; the end note says so. */
  confidence: z.enum(["sure", "guess"]),
});
export type Need = z.infer<typeof NeedSchema>;

/** The shopper's own choice for a need. The solver and the agent keep it unless the shopper changes it. */
export const PinSchema = z.object({
  need_id: z.string().max(32),
  product_id: z.string().max(12),
  /** Packs the shopper set, or null to keep working them out from the amount. */
  qty: z.number().int().min(1).max(10).nullable(),
});
export type Pin = z.infer<typeof PinSchema>;

export const SessionSchema = z.object({
  brief: BriefSchema,
  needs: z.array(NeedSchema).max(40),
  pins: z.array(PinSchema).max(40),
  /**
   * The product each need had after the last solve. Only a hint: a need keeps its product when it is still
   * a good fit, so an edit changes only what it has to. A wrong value can't break a rule.
   */
  picks: z.record(z.string().max(32), z.string().max(12)).default({}),
  /**
   * need id -> product id the agent chose among close options. Not the shopper's pick: it isn't shown as
   * "Your pick", and it gives way when a later rule, diet change or stock-out rules the product out.
   */
  choices: z.record(z.string().max(32), z.string().max(12)).default({}),
});
export type Session = z.infer<typeof SessionSchema>;

// ---------- Solver output ----------

/** What a cart line shows of its product: catalog data only. */
export type LineProduct = {
  id: string;
  name: string;
  brand: string;
  category: Category;
  sub_category: string;
  pack_size: number;
  unit: Unit;
  pack_label: string;
  price: number;
  mrp?: number;
  tags: string[];
};

/** One product the solver compared for a need, for "How I picked this". */
export type Option = {
  product_id: string;
  name: string;
  brand: string;
  pack_label: string;
  price: number;
  packs: number;
  line_total: number;
  /** "₹12 per 100 g" */
  unit_price: string;
  /** 0 = cheapest per gram in its kind, 1 = priciest (adjusted for premium and budget brands). */
  quality: number;
  in_stock: boolean;
};

export type Substitution = {
  wanted: Pick<LineProduct, "id" | "name" | "brand" | "pack_label" | "price">;
  reason: "out_of_stock";
  /** Chosen line total minus what the wanted product would have cost. */
  delta_inr: number;
};

export type Line = {
  need_id: string;
  /** Other needs this line also covers (the same product was the best pick for both). */
  also_for: string[];
  group: string;
  label: string;
  why: string;
  role: Role;
  /** Counted in the total. Unticked pantry items and suggestions are shown but not counted. */
  counted: boolean;
  pinned: boolean;
  product: LineProduct;
  packs: number;
  line_total: number;
  /** The amount the need asked for (after scaling by people), or null for "by the pack". */
  needed: { amount: number; unit: "g" | "ml" | "pcs" } | null;
  /** The amount was worked out per person ("400 g for 4"), not a fixed amount ("15 g"). */
  per_person: boolean;
  picked: { kind: string; compared: Option[]; rule: string };
  substitution: Substitution | null;
  warnings: string[];
  /** The product's listing contains instructions aimed at the agent. They were ignored; the UI says so. */
  flagged: boolean;
  /**
   * The solver wasn't sure: the top two options were close, or the pick is an unusual product for its kind.
   * The agent may choose among the compared options. Never set on pins, agent choices or "N different" needs.
   */
  uncertain: boolean;
};

export type UnmetReason = "unknown_kind" | "none_fit_diet" | "out_of_stock" | "pin_breaks_rule";

export type Cart = {
  lines: Line[];
  /** Sum of the counted lines. Computed in one place (cartTotal) and nowhere else. */
  total: number;
  budget_inr: number | null;
  /** Needs no product could fill. */
  unmet: { need_id: string; label: string; reason: UnmetReason; detail: string }[];
  /** Extras left out to fit the budget. */
  dropped: { need_id: string; label: string; saving_inr: number }[];
  /** Needs left out by a rule: the shopper has it ("have"), or every product of its kind breaks a rule. */
  skipped: { need_id: string; label: string; rule: string; reason: "have" | "rule" }[];
  /** The lowest total that keeps every counted main and core need (cheapest options). */
  floor_inr: number;
};

export type CheckStatus = "pass" | "warn" | "fail";
export type Check = { id: string; status: CheckStatus; label: string };

export function toLineProduct(p: Product, packLabel: string): LineProduct {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    sub_category: p.sub_category,
    pack_size: p.pack_size,
    unit: p.unit,
    pack_label: packLabel,
    price: p.price,
    ...(p.mrp ? { mrp: p.mrp } : {}),
    tags: p.tags,
  };
}

/** The one place a cart's total is computed. */
export function cartTotal(lines: Pick<Line, "counted" | "line_total">[]): number {
  return lines.reduce((sum, l) => (l.counted ? sum + l.line_total : sum), 0);
}

/** 1000 g -> "1 kg", 250 ml -> "250 ml", 6 pcs -> "6 pcs". */
export function amountLabel(amount: number, unit: "g" | "ml" | "pcs" | "pack"): string {
  const n = (x: number) => String(Math.round(x * 10) / 10);
  if (unit === "g" && amount >= 1000) return `${n(amount / 1000)} kg`;
  if (unit === "ml" && amount >= 1000) return `${n(amount / 1000)} L`;
  if (unit === "pack") return `${n(amount)} pack${amount === 1 ? "" : "s"}`;
  return `${n(amount)} ${unit}`;
}
