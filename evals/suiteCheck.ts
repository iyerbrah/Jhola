/**
 * Is each eval chat fair to the agent, given the grocery catalogue? A chat whose checks no cart could pass
 * (a brand the store doesn't stock, an amount no pack can reach, a budget below the cheapest cart) would
 * fail for want of data, not because the agent got it wrong. This checks every chat against the real
 * products, without a model: for each check, could some cart from this catalogue pass it?
 *
 * The chat's constraints come from its own checks and its starting cart: the diet, what it must avoid
 * (brief_avoid, lacks_contains), words it must not contain (lacks, rule_holds), and the start's rules.
 */
import { amountInUnit, excludedBy } from "@/lib/cart/solve";
import { toLineProduct } from "@/lib/cart/types";
import { namesWord } from "@/lib/cart/quality";
import { fitsDiet, type Diet } from "@/lib/requirements";
import { isFood, packLabel, type Contains, type Product } from "@/lib/schema";
import { lineMatches, type ChatScenario } from "./chatScore";
import { setUp } from "./chatScenarios";
import { solveSession } from "@/lib/chat/loop";
import { indexCatalog } from "@/lib/catalog";

const MAX_PACKS = 10;

type Constraints = { diet: Diet | null; avoid: Contains[]; lacks: string[]; fits: (p: Product) => boolean };

function constraints(s: ChatScenario, products: Product[]): Constraints {
  const start = setUp(s, products).start.session.brief;
  let diet: Diet | null = start.diet;
  const avoid = new Set<Contains>(start.avoid ?? []);
  const lacks: string[] = [];
  for (const c of s.checks) {
    if ("diet" in c) diet = c.diet;
    if ("brief_avoid" in c) c.brief_avoid.forEach((x) => avoid.add(x));
    if ("lacks_contains" in c) c.lacks_contains.forEach((x) => avoid.add(x));
    if ("lacks" in c) lacks.push(...c.lacks);
    if ("rule_holds" in c) lacks.push(c.rule_holds);
  }
  const line = (p: Product) => ({ product: toLineProduct(p, packLabel(p)) });
  const fits = (p: Product) =>
    p.in_stock &&
    (!diet || fitsDiet(p, diet)) &&
    !(isFood(p) && (p.contains ?? []).some((x) => avoid.has(x))) &&
    !lacks.some((w) => lineMatches(line(p), w)) &&
    !start.rules.some((r) => r.kind !== "have" && excludedBy(p, r));
  return { diet, avoid: [...avoid], lacks, fits };
}

/** Every reason the chat's checks can't be passed with this catalogue; empty when a correct cart exists. */
export function feasibility(s: ChatScenario, products: Product[]): string[] {
  const out: string[] = [];
  const c = constraints(s, products);
  const ok = products.filter(c.fits);
  const line = (p: Product) => ({ product: toLineProduct(p, packLabel(p)) });
  const matching = (w: string) => ok.filter((p) => lineMatches(line(p), w));
  const where = `${c.diet ? `${c.diet}, ` : ""}${c.avoid.length ? `avoiding ${c.avoid.join("/")}, ` : ""}in stock`;
  const groups: string[][] = [];

  for (const check of s.checks) {
    if ("covers" in check) {
      for (const g of check.covers) {
        groups.push(g);
        if (!g.some((w) => matching(w).length)) out.push(`covers: nothing ${where} for ${g.join("/")}`);
      }
    } else if ("contains_any" in check) {
      groups.push(check.contains_any);
      if (!check.contains_any.some((w) => matching(w).length)) out.push(`contains_any: nothing ${where} for ${check.contains_any.join("/")}`);
    } else if ("count" in check) {
      const [w, n] = check.count;
      const found = matching(w);
      if (found.length < n) out.push(`count: only ${found.length} ${w} ${where}, wants ${n}`);
      const cap = s.checks.find((x) => "max_total" in x) as { max_total: number } | undefined;
      const cheapest = found.map((p) => p.price).sort((a, b) => a - b).slice(0, n).reduce((a, b) => a + b, 0);
      if (cap && cheapest > cap.max_total) out.push(`count: the ${n} cheapest ${w} cost ₹${cheapest}, over ₹${cap.max_total}`);
    } else if ("count_any" in check) {
      const [ws, n] = check.count_any;
      const found = new Set(ws.flatMap((w) => matching(w).map((p) => p.id)));
      if (found.size < n) out.push(`count_any: only ${found.size} products ${where} for ${ws.length} words, wants ${n}`);
    } else if ("amount_range" in check) {
      const [w, min, max] = check.amount_range;
      const reachable = matching(w).some((p) => Array.from({ length: MAX_PACKS }, (_, i) => (i + 1) * p.pack_size).some((a) => a >= min && a <= max));
      if (!reachable) out.push(`amount_range: no pack of ${w} ${where} adds up to ${min}-${max} in 10 packs or fewer`);
    } else if ("pieces_min" in check) {
      const [w, n] = check.pieces_min;
      const reachable = matching(w).some((p) => {
        const perPiece = amountInUnit("pcs", 1, p);
        return perPiece != null && (MAX_PACKS * p.pack_size) / perPiece >= n - 0.5;
      });
      if (!reachable) out.push(`pieces_min: no ${w} ${where} reaches ${n} pieces in 10 packs`);
    } else if ("brands_any" in check) {
      for (const g of check.brands_any)
        if (!ok.some((p) => g.some((b) => namesWord(`${p.brand} ${p.name}`, b)))) out.push(`brands_any: no ${g.join("/")} product ${where}`);
    } else if ("brief_prefer" in check) {
      for (const x of check.brief_prefer) if (!ok.some((p) => p.tags.includes(x) || namesWord(p.brand, x))) out.push(`brief_prefer: nothing ${where} is ${x}`);
    } else if ("injection_ignored" in check) {
      if (!products.some((p) => p.brand === check.injection_ignored && p.description && p.in_stock)) out.push(`injection_ignored: no planted ${check.injection_ignored} listing in stock`);
    } else if ("ready" in check && check.ready !== true) {
      for (const w of check.ready.allow_unmet) {
        const sold = products.filter((p) => p.in_stock && namesWord(`${p.name} ${p.sub_category}`, w));
        if (sold.length) out.push(`ready: "${w}" is allowed to be missing, but the store sells ${sold.slice(0, 2).map((p) => p.name).join(", ")}`);
      }
    }
  }

  // What the chat says the store doesn't sell must really not be on sale.
  for (const w of s.not_sold ?? []) {
    const sold = products.filter((p) => p.in_stock && namesWord(`${p.name} ${p.sub_category}`, w));
    if (sold.length) out.push(`not_sold: the store does sell "${w}": ${sold.slice(0, 2).map((p) => p.name).join(", ")}`);
  }

  // A budget the cart must fit: the cheapest way to meet every required group must fit under it.
  const budget = s.checks.flatMap((x) => ("max_total" in x ? [x.max_total] : "budget_honest" in x && s.checks.some((y) => "ready" in y) ? [x.budget_honest] : []));
  if (budget.length && groups.length) {
    const cheapest = groups.reduce((sum, g) => sum + Math.min(Infinity, ...g.flatMap((w) => matching(w).map((p) => p.price))), 0);
    const limit = Math.min(...budget);
    if (Number.isFinite(cheapest) && cheapest > limit) out.push(`budget: the cheapest product for each required item adds up to ₹${cheapest}, over ₹${limit}`);
  }

  // Stock scenarios: the start cart really has the product that sells out, and there's (or isn't) a stand-in.
  if (s.out_of_stock?.length || s.sold_out_kind?.length || s.pin?.length) {
    const setup = setUp(s, products);
    const after = solveSession(setup.start.session, { products: setup.products, index: indexCatalog(setup.products) }).cart;
    for (const check of s.checks) {
      if ("substituted" in check && !after.lines.some((l) => l.need_id === check.substituted && l.substitution))
        out.push(`substituted: no in-stock stand-in for ${check.substituted} once its pick sells out`);
      if ("kept" in check && !after.lines.some((l) => l.need_id === check.kept && l.pinned)) out.push(`kept: the pin on ${check.kept} doesn't hold`);
    }
    for (const id of s.sold_out_kind ?? []) if (!after.unmet.some((u) => u.need_id === id)) out.push(`sold_out_kind: ${id} still has a product after its kind sells out`);
  }
  return out;
}
