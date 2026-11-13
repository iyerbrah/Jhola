/**
 * The session as the browser sends it, and the changes the shopper makes by tapping instead of chatting
 * (preference chips, ticks, swaps, quantities, confirming a big change). These go through /api/solve:
 * no model call, so they're instant and free. Everything is re-checked here: the browser is untrusted.
 */
import { z } from "zod";
import type { CatalogIndex } from "../catalog";
import { DIET_LABELS, DIETS } from "../requirements";
import { blockedBy } from "../cart/solve";
import { CONTAINS } from "../schema";
import { avoidOf, preferOf, QUALITIES, SessionSchema, type Brief, type Session } from "../cart/types";

export const EMPTY_BRIEF: Brief = { summary: "", people: null, budget_inr: null, diet: null, quality: "balanced", rules: [], assumptions: [], plan: [] };
export const emptySession = (): Session => ({ brief: { ...EMPTY_BRIEF, rules: [], assumptions: [], plan: [] }, needs: [], pins: [], picks: {}, choices: {} });

/** Parses a session from the browser and drops what can't be right (pins and choices for needs that aren't there). */
export function parseSession(input: unknown): { ok: true; session: Session } | { ok: false; error: string } {
  const parsed = SessionSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Invalid session: ${issue?.path.join(".") || "session"} ${issue?.message ?? ""}`.trim() };
  }
  const s = parsed.data;
  const ids = new Set(s.needs.map((n) => n.id));
  if (ids.size !== s.needs.length) return { ok: false, error: "Invalid session: two needs share an id" };
  const pins = s.pins.filter((p, i) => ids.has(p.need_id) && s.pins.findIndex((q) => q.need_id === p.need_id) === i);
  const choices = Object.fromEntries(Object.entries(s.choices).filter(([id]) => ids.has(id)));
  return { ok: true, session: { ...s, pins, choices } };
}

export const ActionSchema = z.discriminatedUnion("type", [
  /** Re-solve as is: opening a shared cart, or applying a change the shopper confirmed. */
  z.object({ type: z.literal("solve") }),
  z.object({
    type: z.literal("brief"),
    people: z.number().int().min(1).max(50).nullable().optional(),
    /** 0 removes the budget. */
    budget_inr: z.number().int().min(0).max(1_000_000).optional(),
    diet: z.enum([...DIETS, "any"]).optional(),
    quality: z.enum(QUALITIES).optional(),
  }),
  z.object({ type: z.literal("remove_rule"), label: z.string().max(60) }),
  /** The shopper taps off an allergy or free-from chip ("No nuts"). */
  z.object({ type: z.literal("remove_avoid"), value: z.enum(CONTAINS) }),
  /** The shopper taps off a standing preference chip ("Organic", "Amul"). */
  z.object({ type: z.literal("remove_prefer"), value: z.string().max(40) }),
  z.object({ type: z.literal("tick"), need_id: z.string().max(32), ticked: z.boolean() }),
  z.object({ type: z.literal("pin"), need_id: z.string().max(32), product_id: z.string().max(12), qty: z.number().int().min(1).max(10).nullable() }),
  z.object({ type: z.literal("unpin"), need_id: z.string().max(32) }),
  z.object({ type: z.literal("remove_need"), need_id: z.string().max(32) }),
]);
export type Action = z.infer<typeof ActionSchema>;

/** Applies one tap to the session. Returns the new session, or a message to show the shopper. */
export function applyAction(s: Session, a: Action, index: CatalogIndex): Session | string {
  switch (a.type) {
    case "solve":
      return s;
    case "brief": {
      const b = { ...s.brief };
      if (a.people !== undefined) b.people = a.people;
      if (a.budget_inr !== undefined) b.budget_inr = a.budget_inr === 0 ? null : a.budget_inr;
      if (a.diet !== undefined) b.diet = a.diet === "any" ? null : a.diet;
      if (a.quality !== undefined) b.quality = a.quality;
      b.summary = summarise(b, s.brief);
      return { ...s, brief: b };
    }
    case "remove_rule": {
      if (!s.brief.rules.some((r) => r.label === a.label)) return `There's no "${a.label}" preference.`;
      return { ...s, brief: { ...s.brief, rules: s.brief.rules.filter((r) => r.label !== a.label) } };
    }
    case "remove_avoid": {
      const avoid = avoidOf(s.brief);
      if (!avoid.includes(a.value)) return `There's no "No ${a.value}" preference.`;
      return { ...s, brief: { ...s.brief, avoid: avoid.filter((c) => c !== a.value) } };
    }
    case "remove_prefer": {
      const p = preferOf(s.brief);
      const next = { labels: p.labels.filter((l) => l !== a.value), brands: p.brands.filter((b) => b !== a.value) };
      if (next.labels.length === p.labels.length && next.brands.length === p.brands.length) return `There's no "${a.value}" preference.`;
      return { ...s, brief: { ...s.brief, prefer: next } };
    }
    case "tick": {
      if (!s.needs.some((n) => n.id === a.need_id)) return "That item isn't in the cart any more.";
      return { ...s, needs: s.needs.map((n) => (n.id === a.need_id ? { ...n, ticked: a.ticked } : n)) };
    }
    case "pin": {
      const need = s.needs.find((n) => n.id === a.need_id);
      if (!need) return "That item isn't in the cart any more.";
      const p = index.get(a.product_id);
      if (!p) return "That product isn't in the catalog.";
      if (!p.in_stock) return `${p.name} is out of stock.`;
      const blocked = blockedBy(p, s.brief);
      if (blocked) return `${p.name} doesn't fit "${blocked === "diet" ? DIET_LABELS[s.brief.diet!] : blocked}".`;
      return { ...s, pins: [...s.pins.filter((x) => x.need_id !== a.need_id), { need_id: a.need_id, product_id: p.id, qty: a.qty }] };
    }
    case "unpin":
      return { ...s, pins: s.pins.filter((x) => x.need_id !== a.need_id) };
    case "remove_need": {
      if (!s.needs.some((n) => n.id === a.need_id)) return "That item isn't in the cart any more.";
      const { [a.need_id]: _gone, ...choices } = s.choices ?? {};
      void _gone;
      return { ...s, needs: s.needs.filter((n) => n.id !== a.need_id), pins: s.pins.filter((x) => x.need_id !== a.need_id), choices };
    }
  }
}

/**
 * Keeps the understanding line true after a chip changes it: "Pasta night, 4 people, vegetarian, around ₹600"
 * becomes "Pasta night, 6 people, vegetarian, around ₹600". Parts it can't find are left alone.
 */
export function summarise(b: Brief, was: Brief): string {
  let s = was.summary;
  if (!s) return s;
  if (b.people !== was.people && was.people != null) s = s.replace(new RegExp(`\\b${was.people}\\s+(people|persons?|guests?)\\b`, "i"), b.people != null ? `${b.people} ${b.people === 1 ? "person" : "people"}` : "");
  if (b.budget_inr !== was.budget_inr && was.budget_inr != null) s = s.replace(new RegExp(`(around |under |below |within )?₹\\s?${was.budget_inr}\\b`, "i"), b.budget_inr != null ? `under ₹${b.budget_inr}` : "");
  if (b.diet !== was.diet && was.diet) s = s.replace(new RegExp(`\\b${DIET_LABELS[was.diet]}\\b`, "i"), b.diet ? DIET_LABELS[b.diet] : "");
  return s.replace(/,\s*,/g, ",").replace(/,\s*$/, "").replace(/\s{2,}/g, " ").trim();
}
