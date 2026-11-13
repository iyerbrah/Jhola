/**
 * Every scenario the shopping agent's eval plays: the hand-written chats in evals/chat/scenarios.json,
 * plus the 35 one-line requests of the cart builder's eval (evals/queries.json), each as a new chat.
 * Also sets a scenario up: its starting session, stock-outs and pins. Pure, so it's unit-tested.
 */
import rawQueries from "./queries.json";
import rawScenarios from "./chat/scenarios.json";
import rawSessions from "./chat/sessions.json";
import rawGoal from "./goal/scenarios.json";
import rawFinal from "./final/suite.json";
import { createMemorySearch, type CatalogSearch } from "@/lib/search";
import { indexCatalog, type CatalogIndex } from "@/lib/catalog";
import { solveSession, type Solved } from "@/lib/chat/loop";
import { emptySession, parseSession } from "@/lib/chat/session";
import type { Product } from "@/lib/schema";
import type { ChatCheck, ChatScenario, Group, Suite } from "./chatScore";

type Query = { group: string; query: string; expected_status: string | string[]; budget_inr?: number; item_count?: number; item_kind?: string; must_include_any?: string[][]; ci?: boolean };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** A cart builder query as a one-turn chat, with the same expectations. */
export function fromQuery(q: Query): ChatScenario {
  const checks: ChatCheck[] = [];
  const statuses = [q.expected_status].flat();
  if (statuses.length === 1 && statuses[0] === "cannot_fulfil") checks.push({ empty: true });
  if (q.must_include_any?.length) checks.push({ covers: q.must_include_any });
  if (q.budget_inr != null) checks.push({ budget_honest: q.budget_inr });
  if (q.item_count != null && q.item_kind) checks.push({ count: [q.item_kind, q.item_count] });
  return { id: `q-${slug(q.query)}`, group: q.group as Group, start: null, turns: [q.query], checks, ...(q.ci ? { ci: true } : {}) };
}

export const SESSIONS = rawSessions as Record<string, unknown>;

/** The final suite: the eval to run, self-contained (evals/final/suite.json). */
export const FINAL = rawFinal as { about: string; scenarios: ChatScenario[] };

/**
 * Every scenario once, or one suite's:
 * - "core": the original eval (hand-written chats and the cart builder's queries);
 * - "goal": the goal suite (evals/goal/scenarios.json): common, occasional and rare chats that must each end
 *   with a grocery cart ready to order;
 * - "final": THE eval (evals/final/suite.json): every capability, with variations, in one run under $1.50.
 * The core and goal suites are kept for deeper runs; the final suite stands on its own.
 */
export function allScenarios(suite?: Suite): ChatScenario[] {
  const core = [...(rawScenarios as ChatScenario[]), ...(rawQueries as Query[]).map(fromQuery)].map((s) => ({ ...s, suite: "core" as const }));
  const goal = (rawGoal as ChatScenario[]).map((s) => ({ ...s, suite: "goal" as const }));
  const own = FINAL.scenarios.map((s) => ({ ...s, suite: "final" as const }));
  if (suite === "core") return core;
  if (suite === "goal") return goal;
  if (suite === "final") return own;
  return [...core, ...goal, ...own];
}

export type ScenarioSetup = { start: Solved; products: Product[]; index: CatalogIndex; search: CatalogSearch; kinds: Set<string> };

/** The scenario's world: its catalog (with any stock-outs), and its starting session solved in it. */
export function setUp(s: ChatScenario, catalog: Product[]): ScenarioSetup {
  let session = emptySession();
  if (s.start) {
    const parsed = parseSession(SESSIONS[s.start]);
    if (!parsed.ok) throw new Error(`${s.id}: session ${s.start}: ${parsed.error}`);
    session = parsed.session;
  }
  const base = { products: catalog, index: indexCatalog(catalog) };
  let start = solveSession(session, base);
  if (s.pin?.length) {
    const pins = s.pin.map((need_id) => {
      const l = start.cart.lines.find((x) => x.need_id === need_id);
      if (!l) throw new Error(`${s.id}: no line for ${need_id} to pin`);
      return { need_id, product_id: l.product.id, qty: null };
    });
    start = solveSession({ ...start.session, pins }, base);
  }
  let products = catalog;
  if (s.out_of_stock?.length) {
    // The start session's picks for these needs sell out: the shopper's cart still lists them.
    const gone = new Set(s.out_of_stock.map((need_id) => start.cart.lines.find((l) => l.need_id === need_id)?.product.id).filter(Boolean));
    products = catalog.map((p) => (gone.has(p.id) ? { ...p, in_stock: false } : p));
  }
  if (s.sold_out_kind?.length) {
    // Nothing of these kinds is left: no stand-in exists, so the cart has to say so.
    const kinds = new Set(s.sold_out_kind.map((need_id) => start.cart.lines.find((l) => l.need_id === need_id)?.product.sub_category).filter(Boolean));
    products = products.map((p) => (kinds.has(p.sub_category) ? { ...p, in_stock: false } : p));
  }
  const index = indexCatalog(products);
  return { start, products, index, search: createMemorySearch(products), kinds: new Set(products.filter((p) => p.in_stock).map((p) => p.sub_category)) };
}
