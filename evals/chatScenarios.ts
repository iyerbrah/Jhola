/**
 * Every scenario the shopping agent's eval plays: the hand-written chats in evals/chat/scenarios.json,
 * plus the 35 one-line requests of the cart builder's eval (evals/queries.json), each as a new chat.
 * Also sets a scenario up: its starting session, stock-outs and pins. Pure, so it's unit-tested.
 */
import rawQueries from "./queries.json";
import rawScenarios from "./chat/scenarios.json";
import rawSessions from "./chat/sessions.json";
import { createMemorySearch, type CatalogSearch } from "@/lib/search";
import { indexCatalog, type CatalogIndex } from "@/lib/catalog";
import { solveSession, type Solved } from "@/lib/chat/loop";
import { emptySession, parseSession } from "@/lib/chat/session";
import type { Product } from "@/lib/schema";
import type { ChatCheck, ChatScenario, Group } from "./chatScore";

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

export function allScenarios(): ChatScenario[] {
  return [...(rawScenarios as ChatScenario[]), ...(rawQueries as Query[]).map(fromQuery)];
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
  const index = indexCatalog(products);
  return { start, products, index, search: createMemorySearch(products), kinds: new Set(products.filter((p) => p.in_stock).map((p) => p.sub_category)) };
}
