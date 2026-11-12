/**
 * The self-check every cart gets before it's shown: the checklist above the cart, and what the agent
 * reads before it may finish. It re-checks the cart against the catalog and the Brief on its own,
 * without trusting the solver, so a solver bug shows up as a failed check instead of a bad cart.
 */
import type { CatalogIndex } from "../catalog";
import { DIET_LABELS, fitsDiet } from "../requirements";
import { singular } from "./quality";
import { excludedBy } from "./solve";
import type { Cart, Check, Need, Session } from "./types";
import { cartTotal } from "./types";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function review(session: Session, cart: Cart, index: CatalogIndex): Check[] {
  const { brief, needs } = session;
  const checks: Check[] = [];
  const counted = cart.lines.filter((l) => l.counted);

  // Stock, and the catalog's own prices and packs.
  const notInStock = cart.lines.filter((l) => !index.get(l.product.id)?.in_stock);
  const swapped = cart.lines.filter((l) => l.substitution).length;
  checks.push(
    notInStock.length
      ? { id: "stock", status: "fail", label: `Out of stock: ${notInStock.map((l) => l.product.name).join(", ")}` }
      : { id: "stock", status: "pass", label: swapped ? `All in stock (${swapped} swapped)` : "All in stock" },
  );
  const badPrice = cart.lines.filter((l) => {
    const p = index.get(l.product.id);
    return !p || p.price !== l.product.price || l.line_total !== p.price * l.packs || !Number.isInteger(l.packs) || l.packs < 1 || l.packs > 10;
  });
  if (badPrice.length || cart.total !== cartTotal(cart.lines)) {
    checks.push({ id: "prices", status: "fail", label: "A price or total doesn't match the catalog" });
  }

  // Amounts for the head count.
  if (needs.some((n) => n.per_person) && brief.people) {
    const capped = cart.lines.some((l) => l.warnings.some((w) => w.startsWith("Needs more than")));
    checks.push({ id: "people", status: capped ? "warn" : "pass", label: `Amounts for ${brief.people} ${brief.people === 1 ? "person" : "people"}` });
  }

  // Budget.
  if (brief.budget_inr != null) {
    const over = cart.total - brief.budget_inr;
    checks.push(
      over > 0
        ? { id: "budget", status: "fail", label: `₹${over} over the ₹${brief.budget_inr} budget` }
        : { id: "budget", status: "pass", label: `Under ₹${brief.budget_inr}` },
    );
  }

  // Diet: food only; non-food fits every diet.
  if (brief.diet) {
    const breaks = counted.filter((l) => !fitsDiet(l.product, brief.diet!));
    checks.push(
      breaks.length
        ? { id: "diet", status: "fail", label: `Not ${DIET_LABELS[brief.diet]}: ${breaks.map((l) => l.product.name).join(", ")}` }
        : { id: "diet", status: "pass", label: cap(DIET_LABELS[brief.diet]) },
    );
  }

  // Each standing rule, by name.
  for (const rule of brief.rules) {
    if (rule.kind === "have") {
      if (cart.skipped.some((s) => s.rule === rule.label)) checks.push({ id: `rule:${rule.label}`, status: "pass", label: rule.label });
      continue;
    }
    const breaks = cart.lines.filter((l) => {
      const p = index.get(l.product.id);
      return p && excludedBy(p, rule);
    });
    // Needs the rule left out are the rule working: listed under it, not as warnings.
    const left = cart.skipped.filter((s) => s.reason === "rule" && s.rule === rule.label).map((s) => s.label.toLowerCase());
    checks.push(
      breaks.length
        ? { id: `rule:${rule.label}`, status: "fail", label: `${rule.label}, but the cart has ${breaks.map((l) => l.product.name).join(", ")}` }
        : { id: `rule:${rule.label}`, status: "pass", label: left.length ? `${rule.label} (left out ${left.join(", ")})` : rule.label },
    );
  }

  // One line per product.
  const ids = cart.lines.map((l) => l.product.id);
  checks.push(new Set(ids).size === ids.length ? { id: "duplicates", status: "pass", label: "No duplicates" } : { id: "duplicates", status: "fail", label: "A product is listed twice" });

  // Honest warnings.
  for (const u of cart.unmet) checks.push({ id: `unmet:${u.need_id}`, status: "warn", label: `No ${u.label.toLowerCase()}: ${u.detail}` });
  for (const d of cart.dropped) checks.push({ id: `dropped:${d.need_id}`, status: "warn", label: `Left out ${d.label.toLowerCase()} to fit the budget` });
  for (const l of cart.lines.filter((x) => x.flagged)) {
    checks.push({ id: `flagged:${l.product.id}`, status: "warn", label: `${l.product.name}'s listing has hidden instructions; Jhola ignored them` });
  }
  const seen = new Set<string>();
  for (const l of cart.lines) {
    for (const w of l.warnings) {
      if (seen.has(w)) continue;
      seen.add(w);
      checks.push({ id: `warn:${l.need_id}:${seen.size}`, status: "warn", label: w });
    }
  }
  return checks;
}

/** True when nothing failed (warnings are fine: they're said out loud). */
export function passes(checks: Check[]): boolean {
  return checks.every((c) => c.status !== "fail");
}

/** Words that say how much or what form, not what: they never decide whether a list line is covered. */
const PLAN_STOP = new Set(
  "and or with for the of a an some few fresh small large big medium pack packs packet bunch bottle jar box loaf piece pcs pc gram grams kg ml litre liter dozen each per person people optional any plain regular everyday".split(" "),
);

const planWords = (text: string) =>
  (text.toLowerCase().replace(/_/g, " ").match(/[a-z]{3,}/g) ?? []).map(singular).filter((w) => !PLAN_STOP.has(w));

const AMOUNT = /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|grams?|ml|l|ltrs?|litres?|liters?|pcs?|pieces?|dozen)\b/i;
const lineWords = (line: string) => planWords(line.replace(/\(optional\)/gi, " ").replace(/\d[\d.,/]*\s*(kg|g|gm|ml|l|litres?|pcs?|packs?|x)?\b/gi, " "));
const needWords = (n: Pick<Need, "label" | "kind" | "prefer">) => planWords(`${n.label} ${n.kind} ${n.prefer ?? ""}`);
const wordsMeet = (a: string[], b: string[]) => a.some((w) => b.some((v) => v === w || (v.length >= 4 && w.length >= 4 && (v.includes(w) || w.includes(v)))));

/**
 * Shopping-list lines no need covers, so a planned item can't be silently dropped. A line is covered when
 * one of its words (amounts and "(optional)" stripped) is a word of some need's label, kind or prefer.
 */
export function planCoverage(plan: string[], needs: Pick<Need, "label" | "kind" | "prefer">[]): string[] {
  const vocab = needs.flatMap(needWords);
  return plan.filter((line) => {
    const words = lineWords(line);
    return words.length > 0 && !wordsMeet(words, vocab);
  });
}

/** "2 kg" -> {2000, g}; "7 L" -> {7000, ml}; "12 pcs" / "1 dozen" -> {12, pcs}. */
export function listAmount(line: string): { amount: number; unit: "g" | "ml" | "pcs" } | null {
  const m = line.match(AMOUNT);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (/^kg/.test(u)) return { amount: n * 1000, unit: "g" };
  if (/^(g|gm|gram)/.test(u)) return { amount: n, unit: "g" };
  if (u === "ml") return { amount: n, unit: "ml" };
  if (/^(l|ltr|litre|liter)/.test(u)) return { amount: n * 1000, unit: "ml" };
  if (u === "dozen") return { amount: n * 12, unit: "pcs" };
  return { amount: n, unit: "pcs" };
}

/**
 * Needs whose amount is far from what their shopping-list line says: "rice 2 kg" written as 2 g, or
 * "milk 7 L" as 500 ml. The usual cause is a unit slip (kg for g). Off by 3× or more either way.
 */
export function planAmountMismatches(plan: string[], needs: Need[], people: number | null): string[] {
  const out: string[] = [];
  const g2ml = (u: string) => (u === "ml" ? "g" : u);
  for (const line of plan) {
    const listed = listAmount(line);
    if (!listed) continue;
    const words = lineWords(line);
    const matches = needs.filter((n) => n.unit !== "pack" && g2ml(n.unit) === g2ml(listed.unit) && wordsMeet(words, needWords(n)));
    if (matches.length !== 1) continue; // none, or a line split across needs: can't compare
    const n = matches[0];
    const total = n.amount * (n.per_person ? (people ?? 2) : 1);
    if (total * 3 <= listed.amount || total >= listed.amount * 3) {
      out.push(`need "${n.id}" comes to ${Math.round(total * 10) / 10} ${n.unit} in all, but the shopping list says "${line}": amounts are in g, ml or pieces (2 kg is 2000 g), per person when per_person is true`);
    }
  }
  return out;
}
