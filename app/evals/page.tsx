import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { REPO_URL, SiteFooter } from "@/components/SiteFooter";
import type { ChatSummary, ScenarioScore } from "@/evals/chatScore";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Results",
  description: "How reliably Jhola's shopping agent builds and edits carts: about 80 scripted chats against the real model, checked in code, plus a solver benchmark of thousands of random sessions.",
};

type Transcript = { message: string; status: string; reply: string; question: string | null; total: number; lines: string[]; note: string[]; model_calls: number; ms: number };
type Run = { meta: { ran_at: string; model: string; scenarios: number; ci: boolean; wall_s: number }; summary: ChatSummary; scores: ScenarioScore[]; transcripts: Record<string, Transcript[]> };
type Bench = { ran_at: string; sessions: number; catalog_size: number; valid_rate: number; within_budget_when_possible: number | null; budget_possible: number; stable_rate: number; ms_p50: number; ms_p95: number; lines_per_cart: number; substitutions_per_cart: number };

/** The newest full run (not a PR check), read at build time. */
function latestRun(): Run | null {
  try {
    const dir = path.join(process.cwd(), "evals/chat/results");
    const f = fs.readdirSync(dir).filter((x) => x.endsWith(".json") && !x.endsWith("-ci.json")).sort().at(-1);
    return f ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) : null;
  } catch {
    return null;
  }
}
function bench(): Bench | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "evals/solver/latest.json"), "utf8"));
  } catch {
    return null;
  }
}

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const CATEGORY: Record<string, string> = {
  coverage: "Missed an ingredient",
  amount: "Amount off",
  budget: "Budget",
  diet_or_rule: "Broke a diet or rule",
  collateral: "Changed what wasn't asked",
  behaviour: "Wrong behaviour",
  stock: "Stock recovery",
  safety: "Followed an injection",
  efficiency: "Too many steps",
  gave_up: "Gave up",
};
const GROUP: Record<string, string> = {
  recipe: "Recipes",
  meal_idea: "Meal ideas",
  budget_gift: "Budgets and gifts",
  household: "Household",
  edge: "Edge cases",
  build: "New chats",
  edit: "Edits",
  diet: "Diet changes",
  budget: "Budget changes",
  memory: "Remembering rules",
  stock: "Stock-outs and pins",
  question: "Questions",
  not_possible: "Things it can't do",
  safety: "Prompt injection",
  confirm: "Confirming big changes",
};

export default function EvalsPage() {
  const run = latestRun();
  const b = bench();
  const s = run?.summary;
  const tiles = s
    ? [
        ["Scenarios passed", `${s.passed} / ${s.scenarios}`, `${pct(s.task_success)} task success`],
        ["Rule breaks", String(s.rule_breaks), "stock, price, diet, rules, duplicates"],
        ["Ingredient coverage", pct(s.ingredient_coverage), "required items found"],
        ["Budgets kept", pct(s.budget_kept), "or honestly said impossible"],
        ["Diets and rules held", pct(s.rules_held), "across every turn"],
        ["Edits that changed only what was asked", pct(s.collateral_free), `${s.collateral_per_edit ?? "–"} unasked changes per edit`],
        ["Injections obeyed", String(s.injection_obeyed), "in the message or a listing"],
        ["Speed", `${(s.latency_p50_ms / 1000).toFixed(1)} s`, `p95 ${(s.latency_p95_ms / 1000).toFixed(1)} s · ${s.model_calls_median} model call per turn (median)`],
        ["Cost", `₹${(s.cost_per_turn_usd * 88).toFixed(2)}`, `$${s.cost_per_turn_usd.toFixed(4)} per turn · ${pct(s.finished_by_code)} of turns ended by code`],
      ]
    : [];
  const failed = run ? run.scores.filter((x) => !x.passed) : [];

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="font-display text-3xl leading-none text-ink">
          Jhola
        </Link>
        <nav className="flex gap-5 text-sm font-semibold">
          <Link href="/how-it-works" className="underline underline-offset-4">
            How it works
          </Link>
          <Link href="/stats" className="underline underline-offset-4">
            Live stats
          </Link>
        </nav>
      </header>
      <main>
        <h1 className="font-display text-5xl leading-tight">Results</h1>
        <p className="mt-3 max-w-3xl text-lg text-ink-soft">
          Every change to Jhola is measured, not just demoed. The eval plays about 80 chats against the real model: new requests, edits, diet and budget changes, rules that must last, stock-outs, questions, requests it can&apos;t do, prompt injection and big changes that need a yes. Code checks
          every result; there&apos;s no AI judge.
        </p>

        {s && run ? (
          <>
            <p className="mt-6 text-sm text-ink-soft">
              Run on {run.meta.ran_at.slice(0, 10)} with {run.meta.model}, {s.turns} turns.
            </p>
            <section aria-label="Headline numbers" className="mt-3 grid gap-3 sm:grid-cols-3">
              {tiles.map(([title, value, sub]) => (
                <div key={title} className="rounded-2xl border-2 border-ink bg-paper p-4">
                  <p className="text-sm text-ink-soft">{title}</p>
                  <p className="num font-display text-3xl text-ink">{value}</p>
                  <p className="text-sm text-ink-soft">{sub}</p>
                </div>
              ))}
            </section>

            <section className="mt-10 grid gap-8 lg:grid-cols-2">
              <div>
                <h2 className="font-display text-2xl">By kind of request</h2>
                <table className="mt-3 w-full text-left">
                  <tbody>
                    {Object.entries(s.by_group).map(([g, v]) => (
                      <tr key={g} className="border-b border-line">
                        <td className="py-1.5">{GROUP[g] ?? g}</td>
                        <td className="num py-1.5 text-right font-semibold">
                          {v.passed} / {v.scenarios}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h2 className="font-display text-2xl">Common failures</h2>
                {Object.keys(s.failures_by_category).length === 0 ? (
                  <p className="mt-3 text-ink-soft">None in this run.</p>
                ) : (
                  <table className="mt-3 w-full text-left">
                    <tbody>
                      {Object.entries(s.failures_by_category)
                        .sort((a, b) => b[1] - a[1])
                        .map(([c, n]) => (
                          <tr key={c} className="border-b border-line">
                            <td className="py-1.5">{CATEGORY[c] ?? c}</td>
                            <td className="num py-1.5 text-right font-semibold">{n}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {failed.length > 0 && (
              <section className="mt-10">
                <h2 className="font-display text-2xl">Every failed scenario</h2>
                <p className="mt-1 text-ink-soft">What was asked, what went wrong, and what Jhola did.</p>
                <ul className="mt-3 space-y-2">
                  {failed.map((f) => (
                    <li key={f.id}>
                      <details className="rounded-2xl border border-line bg-paper px-4 py-3">
                        <summary className="cursor-pointer">
                          <span className="font-semibold">{f.id}</span> <span className="text-ink-soft">· {f.failures.map((x) => `${CATEGORY[x.category] ?? x.category}: ${x.detail}`).join("; ")}</span>
                        </summary>
                        <ol className="mt-2 space-y-2 text-sm">
                          {(run.transcripts[f.id] ?? []).map((t, i) => (
                            <li key={i}>
                              <p>
                                <span className="font-semibold">Shopper:</span> {t.message}
                              </p>
                              <p>
                                <span className="font-semibold">Jhola</span> ({t.status}, {t.model_calls} model calls, {(t.ms / 1000).toFixed(1)} s): {t.reply}
                                {t.question ? ` (asked: ${t.question})` : ""}
                              </p>
                              <p className="text-ink-soft">
                                ₹{t.total}: {t.lines.join("; ") || "empty"}
                              </p>
                            </li>
                          ))}
                        </ol>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <p className="mt-6 rounded-2xl border-2 border-ink bg-paper p-5">No full eval run is saved yet. Run it with npm run eval:chat.</p>
        )}

        {b && (
          <section className="mt-12">
            <h2 className="font-display text-2xl">The solver, on {b.sessions.toLocaleString("en-IN")} random sessions</h2>
            <p className="mt-1 max-w-3xl text-ink-soft">
              The agent decides what&apos;s needed; a solver in code picks products, packs and prices. It&apos;s benchmarked on seeded random sessions over all {b.catalog_size.toLocaleString("en-IN")} products, with no model calls, and property-tested on every change.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              {[
                ["Valid carts", pct(b.valid_rate)],
                ["Within budget when possible", pct(b.within_budget_when_possible)],
                ["Stable when nothing changed", pct(b.stable_rate)],
                ["Solve time", `${b.ms_p50} ms`],
              ].map(([t, v]) => (
                <div key={t} className="rounded-2xl border border-line bg-paper p-4">
                  <p className="text-sm text-ink-soft">{t}</p>
                  <p className="num font-display text-2xl">{v}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 text-ink-soft">
          The scenarios, checks and every saved run are in the{" "}
          <a href={`${REPO_URL}/tree/main/evals`} className="font-semibold text-ink underline underline-offset-4">
            repository
          </a>
          . A pull request that changes answers runs the PR subset and fails if it breaks a rule or scores below the saved baseline.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
