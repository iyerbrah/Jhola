import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { day, pct, secs, usd } from "@/components/format";
import { REPO_URL, SiteFooter } from "@/components/SiteFooter";
import { SignHeadline, SiteHeader } from "@/components/SiteHeader";
import { TrendChart, type TrendPoint } from "@/components/results/TrendChart";
import { button, CARD, H2, H3, Notice, StatBoard } from "@/components/ui";
import type { ChatSummary, ScenarioScore } from "@/evals/chatScore";
import { change, HISTORY_FILE, LATEST_FILE, THEMES, themeScores, type HistoryEntry } from "@/evals/history";
import { loadStats, type Stats } from "@/lib/log/stats";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Results",
  description:
    "How accurate Jhola's shopping agent is, and how that changes over time: a fixed eval of scripted chats checked in code, and how real chats on the live site end, both tracked run by run and day by day.",
};

type Transcript = { message: string; status: string; reply: string; question: string | null; total: number; lines: string[]; note: string[]; model_calls: number; ms: number };
type Run = {
  meta: { ran_at: string; model: string; scenarios: number; spent_usd?: number; cap_usd?: number | null; skipped?: string[]; commit?: string | null; note?: string };
  summary: ChatSummary;
  scores: ScenarioScore[];
  transcripts: Record<string, Transcript[]>;
};
type Bench = { sessions: number; catalog_size: number; valid_rate: number; within_budget_when_possible: number | null; stable_rate: number; ms_p50: number };

const read = <T,>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf8")) as T;
  } catch {
    return null;
  }
};


const CATEGORY: Record<string, string> = {
  not_ready: "Cart not ready to order",
  coverage: "Missed an item",
  amount: "Amount off",
  budget: "Budget",
  diet_or_rule: "Broke a diet, allergy or rule",
  collateral: "Changed what wasn't asked",
  behaviour: "Wrong behaviour",
  stock: "Stock recovery",
  safety: "Followed an injection",
  efficiency: "Too many steps",
  gave_up: "Gave up",
};
const GROUP: Record<string, string> = {
  everyday: "Everyday lists, amounts and counts",
  recipe: "Recipes",
  occasion: "Occasions and parties",
  household: "Household and cleaning",
  personal: "Personal care, baby and pet",
  build: "New chats",
  meal_idea: "Meal ideas",
  dietary: "Diets, allergies and preferences",
  diet: "Diet changes to a cart",
  budget: "Budgets",
  budget_gift: "Budgets and gifts",
  edit: "Edits to a cart",
  memory: "Remembering over several messages",
  conversation: "Building a cart step by step",
  stock: "Stock-outs and pins",
  question: "Answering the shopper's questions",
  asking: "Asking when it should, and only then",
  not_possible: "Things it can't do",
  safety: "Prompt injection",
  confirm: "Big changes wait for a yes",
  rare: "Typos, Hinglish, brands, odd requests",
  edge: "Edge cases",
};

/** Live ready rate over the last `n` days and the `n` before, weighted by judged chats. */
function liveWindow(daily: Stats["daily"], from: number, n: number): number | null {
  const days = daily.slice(Math.max(0, daily.length - from - n), daily.length - from);
  const judged = days.reduce((s, d) => s + d.judged_chats, 0);
  return judged ? days.reduce((s, d) => s + (d.ready_rate ?? 0) * d.judged_chats, 0) / judged : null;
}

export default async function ResultsPage() {
  const run = read<Run>(LATEST_FILE);
  const history = read<HistoryEntry[]>(HISTORY_FILE) ?? [];
  const bench = read<Bench>("evals/solver/latest.json");
  let stats: Stats | null = null;
  let liveDown = false;
  try {
    stats = await loadStats();
  } catch (err) {
    console.error("[results] couldn't read the request log:", err instanceof Error ? err.message : err);
    liveDown = true;
  }

  const s = run?.summary;
  const prev = history.at(-2);
  const first = history[0];
  const latest = history.at(-1);
  const a = stats?.accuracy;
  const liveNow = stats ? liveWindow(stats.daily, 0, 7) : null;
  const liveBefore = stats ? liveWindow(stats.daily, 7, 7) : null;
  const votes = stats?.feedback.votes ?? 0;

  const measured: [string, string, string][] = s
    ? [
        ["Carts ready to order", pct(s.ready_to_order), change(s.ready_to_order, prev?.ready_to_order) ? `${change(s.ready_to_order, prev?.ready_to_order)} since ${day(prev!.ran_at)}` : `of ${s.scenarios} scripted chats`],
        ["Chats passed", `${s.passed} / ${s.scenarios}`, change(s.task_success, prev?.task_success) ? `${change(s.task_success, prev?.task_success)} since ${day(prev!.ran_at)}` : "every check in the chat"],
        ["Rule breaks", String(s.rule_breaks), "a cart that broke the shopper's diet, allergy or rules"],
      ]
    : [];
  const live: [string, string, string][] = stats
    ? [
        ["Runs that ended in an order", pct(stats.success.order_rate), `${stats.success.ordered} of ${stats.success.runs} runs`],
        ["Carts ready to order", pct(a?.ready_rate), a?.judged_chats ? `checked in code, ${a.judged_chats} real chats${change(liveNow, liveBefore) ? `, ${change(liveNow, liveBefore)} on the week before` : ""}` : "checked in code, from the next chat on"],
        ["Messages to order", stats.success.messages_median == null ? "–" : String(Math.round(stats.success.messages_median * 10) / 10), "median, before the order"],
        ["Average rating", stats.success.avg_stars == null ? "–" : `★ ${stats.success.avg_stars.toFixed(1)}`, `from ${stats.success.ratings} rating${stats.success.ratings === 1 ? "" : "s"}`],
        ["Helpful replies", votes ? pct(stats.feedback.up / votes) : "–", `${votes} vote${votes === 1 ? "" : "s"}`],
        ["Turns that went wrong", pct((stats.totals.give_up_rate ?? 0) + (stats.totals.error_rate ?? 0)), "gave up or failed"],
      ]
    : [];

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader current="results">
        <SignHeadline title="Results">
          <p>
            How accurate Jhola&apos;s AI shopping agent is, and whether it&apos;s getting better. Two kinds of evidence: a fixed eval of {s?.scenarios ?? "about 100"} scripted chats played against the real model
            and checked in code (no AI judge), and how real chats on this site end. The goal in both is the same: a grocery cart the shopper could order as it is.
          </p>
        </SignHeadline>
      </SiteHeader>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        {/* 1. Accuracy now */}
        <section aria-labelledby="now" className="mt-10">
          <h2 id="now" className={H2}>
            Accuracy now
          </h2>
          <div className="mt-5 grid gap-10 lg:grid-cols-2">
            <div>
              <h3 className={`mb-3 ${H3}`}>Measured: the eval{run ? `, run on ${day(run.meta.ran_at)} with ${run.meta.model}` : ""}</h3>
              {s ? <StatBoard cols={3} items={measured} /> : <Notice>No eval run saved yet. Run it with npm run eval:chat.</Notice>}
            </div>
            <div>
              <h3 className={`mb-3 ${H3}`}>In use: real runs, last 30 days</h3>
              {liveDown ? (
                <Notice tone="warn">The request log can&apos;t be reached right now; check back in a minute.</Notice>
              ) : stats ? (
                <StatBoard cols={3} items={live} />
              ) : (
                <Notice>Live numbers come from the site&apos;s database, which isn&apos;t connected here.</Notice>
              )}
            </div>
          </div>
        </section>

        {/* 2. Over time */}
        <section aria-labelledby="time" className="mt-14">
          <h2 id="time" className={H2}>
            Accuracy over time
          </h2>
          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div className={CARD}>
              <h3 className={H3}>The eval, run by run</h3>
              <p className="mt-1 text-sm text-ink-soft">
                {history.length >= 2 && first && latest
                  ? `Ready to order ${pct(first.ready_to_order)} → ${pct(latest.ready_to_order)} over ${history.length} runs, since ${day(first.ran_at)}.`
                  : history.length === 1
                    ? "One run so far: each new run adds a point, and the line shows whether changes helped."
                    : "No runs saved yet."}
              </p>
              {history.length > 0 && (
                <div className="mt-4">
                  <TrendChart
                    caption="The eval's ready-to-order and pass rates, one point per run."
                    series={[
                      { key: "ready", label: "Carts ready to order" },
                      { key: "passed", label: "Chats passed" },
                    ]}
                    points={history.map(
                      (h): TrendPoint => ({
                        label: day(h.ran_at),
                        title: `${day(h.ran_at)}${h.commit ? ` (${h.commit})` : ""}: ready ${pct(h.ready_to_order)}, passed ${h.passed}/${h.scenarios}, ${h.rule_breaks} rule break${h.rule_breaks === 1 ? "" : "s"}${h.note ? `. ${h.note}` : ""}`,
                        values: { ready: h.ready_to_order, passed: h.task_success },
                      }),
                    )}
                  />
                </div>
              )}
            </div>
            <div className={CARD}>
              <h3 className={H3}>Real chats, day by day</h3>
              <p className="mt-1 text-sm text-ink-soft">
                {a?.tracked_since ? `Judged since ${day(a.tracked_since)}, the same way the eval judges a chat.` : "Each chat is judged from its last turn, the same way the eval judges a chat."}
              </p>
              {stats ? (
                <div className="mt-4">
                  <TrendChart
                    caption="Real chats that ended ready to order, and the thumbs-up rate, per day."
                    series={[
                      { key: "ready", label: "Ready to order" },
                      { key: "up", label: "Thumbs up" },
                    ]}
                    points={stats.daily.map(
                      (d): TrendPoint => ({
                        label: day(d.day),
                        title: `${day(d.day)}: ${d.judged_chats} judged chat${d.judged_chats === 1 ? "" : "s"}, ready ${pct(d.ready_rate)}; ${d.votes} vote${d.votes === 1 ? "" : "s"}`,
                        values: { ready: d.ready_rate, up: d.votes ? d.up / d.votes : null },
                      }),
                    )}
                  />
                </div>
              ) : (
                <p className="mt-4 text-ink-soft">Shown on the live site.</p>
              )}
            </div>
          </div>
          {history.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className={`cursor-pointer ${button("quiet")}`}>Every eval run</summary>
              <table className="mt-2 w-full text-left">
                <thead className="text-ink-soft">
                  <tr>
                    <th className="py-1 font-semibold">Run</th>
                    <th className="py-1 font-semibold">What changed</th>
                    <th className="py-1 text-right font-semibold">Ready</th>
                    <th className="py-1 text-right font-semibold">Passed</th>
                    <th className="py-1 text-right font-semibold">Rule breaks</th>
                    <th className="py-1 text-right font-semibold">Cost a turn</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {[...history].reverse().map((h) => (
                    <tr key={h.ran_at} className="border-t border-line align-top">
                      <td className="py-1.5">
                        {day(h.ran_at)} {h.commit && <span className="text-ink-soft">({h.commit})</span>}
                      </td>
                      <td className="py-1.5 font-sans">{h.note || "–"}</td>
                      <td className="py-1.5 text-right">{pct(h.ready_to_order)}</td>
                      <td className="py-1.5 text-right">
                        {h.passed}/{h.scenarios}
                      </td>
                      <td className="py-1.5 text-right">{h.rule_breaks}</td>
                      <td className="py-1.5 text-right">{usd(h.cost_per_turn_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>

        {s && run && <EvalDetail run={run} prev={prev} />}

        {/* 6. Running in production */}
        <section aria-labelledby="runs" className="mt-14">
          <h2 id="runs" className={H2}>
            Every run, in detail
          </h2>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Cost, time, model and tool calls, traces, how each chat ended and what shoppers said about it are on the{" "}
            <Link href="/history" className={button("quiet")}>
              History
            </Link>{" "}
            page.
          </p>
        </section>

        {bench && (
          <section className="mt-14">
            <h2 className={H2}>The solver, on {bench.sessions.toLocaleString("en-IN")} random carts</h2>
            <p className="mt-2 max-w-3xl leading-relaxed text-ink-soft">
              The agent decides what&apos;s needed; a solver in code picks products, packs and prices. It&apos;s tested on seeded random sessions over all {bench.catalog_size.toLocaleString("en-IN")}{" "}
              grocery products, with no model calls.
            </p>
            <div className="mt-6">
              <StatBoard
                cols={4}
                items={[
                  ["Valid carts", pct(bench.valid_rate)],
                  ["Within budget when possible", pct(bench.within_budget_when_possible)],
                  ["Stable when nothing changed", pct(bench.stable_rate)],
                  ["Solve time", `${bench.ms_p50} ms`, "median"],
                ]}
              />
            </div>
          </section>
        )}

        {/* 7. How to read this */}
        <section aria-labelledby="read" className="mt-14 max-w-3xl">
          <h2 id="read" className={H2}>
            How to read this
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-ink">
            <li>
              <strong>The eval</strong> is a fixed set of scripted chats, so runs can be compared: new carts, edits, diets and allergies, budgets, typos and Hinglish, stock-outs, questions both ways,
              refusals, prompt injection and big changes that wait for a yes. Every result is checked in code.
            </li>
            <li>
              <strong>Real runs</strong> are judged the same way, from each chat&apos;s last turn, and the main measure is whether the shopper pressed &ldquo;Looks good, I&apos;m done&rdquo;. This page shows
              totals; <Link href="/history" className={button("quiet")}>History</Link> lists every run, with chat messages kept behind the admin key.
            </li>
            <li>
              <strong>One run is a snapshot.</strong> The model doesn&apos;t answer identically every time, so a few points either way between runs can be chance; a trend over several runs is the
              signal.
            </li>
            <li>
              A pull request that changes the agent can run a {""}
              <a href={`${REPO_URL}/tree/main/evals/final`} className={button("quiet")}>
                37-chat subset
              </a>{" "}
              when the PR gets the run-evals label. A full run is capped at $1.50.
            </li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function EvalDetail({ run, prev }: { run: Run; prev: HistoryEntry | undefined }) {
  const s = run.summary;
  const themes = themeScores(s.by_group);
  const byTheme = THEMES.map((t) => ({ ...t, score: themes[t.id], groups: t.groups.filter((g) => s.by_group[g]) })).filter((t) => t.score);
  const themeOf = (group: string) => THEMES.find((t) => t.groups.includes(group))?.id ?? "limits";
  const skipped = run.meta.skipped?.length ?? 0;
  return (
    <>
      {/* 3. What the agent can do */}
      <section aria-labelledby="can" className="mt-14">
        <h2 id="can" className={H2}>
          What the agent can do
        </h2>
        <p className="mt-2 text-ink-soft">
          The latest eval, by capability: {s.scenarios} chats, {s.turns} turns{run.meta.spent_usd != null ? `, ${usd(run.meta.spent_usd)} to run` : ""}
          {skipped ? `, ${skipped} skipped to stay under the cost cap` : ""}.
        </p>
        <div className="mt-5 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {byTheme.map((t) => (
            <div key={t.id} className="border-t-[3px] border-sign pt-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className={H3}>{t.title}</h3>
                <span className="num font-sign text-2xl text-ink">
                  {t.score.passed}/{t.score.scenarios}
                </span>
              </div>
              {prev?.by_theme?.[t.id] && (
                <p className="text-xs text-ink-soft">
                  {change(t.score.passed / t.score.scenarios, prev.by_theme[t.id].passed / prev.by_theme[t.id].scenarios) ?? ""} since {day(prev.ran_at)}
                </p>
              )}
              <dl className="mt-2 divide-y divide-line text-sm">
                {t.groups.map((g) => (
                  <div key={g} className="flex justify-between gap-3 py-1.5">
                    <dt className="text-ink">{GROUP[g] ?? g}</dt>
                    <dd className="num font-semibold text-ink">
                      {s.by_group[g].passed}/{s.by_group[g].scenarios}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Where it fails */}
      <section aria-labelledby="fails" className="mt-14 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 id="fails" className={H2}>
            Where it fails
          </h2>
          {Object.keys(s.failures_by_category).length === 0 ? (
            <p className="mt-3 text-ink-soft">No failed checks in the latest run.</p>
          ) : (
            <table className="mt-4 w-full border-y-2 border-sign text-left">
              <tbody>
                {Object.entries(s.failures_by_category)
                  .sort((x, y) => y[1] - x[1])
                  .map(([c, n]) => (
                    <tr key={c} className="border-b border-line last:border-b-0">
                      <td className="py-2">{CATEGORY[c] ?? c}</td>
                      <td className="num py-2 text-right font-semibold">{n}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h2 className={H2}>Also measured</h2>
          <table className="mt-4 w-full border-y-2 border-sign text-left">
            <tbody>
              {(
                [
                  ["Diets, allergies and rules held", pct(s.rules_held)],
                  ["Budgets kept, or honestly said impossible", pct(s.budget_kept)],
                  ["Edits that changed only what was asked", pct(s.collateral_free)],
                  ["Prompt injections obeyed", String(s.injection_obeyed)],
                  ["Reply time, median", secs(s.latency_p50_ms)],
                  ["Cost per turn", usd(s.cost_per_turn_usd)],
                ] as const
              ).map(([k, v]) => (
                <tr key={k} className="border-b border-line last:border-b-0">
                  <td className="py-2">{k}</td>
                  <td className="num py-2 text-right font-semibold">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. Every chat, by theme */}
      <section aria-labelledby="every" className="mt-14">
        <h2 id="every" className={H2}>
          Every eval chat
        </h2>
        <p className="mt-2 text-ink-soft">What the shopper said, and whether it passed. A failed chat opens to what went wrong and the whole conversation.</p>
        <div className="mt-4 space-y-3">
          {byTheme.map((t) => {
            const chats = run.scores.filter((x) => themeOf(x.group) === t.id);
            return (
              <details key={t.id} className="rounded-md border-2 border-line bg-paper px-4 py-3 open:border-sign">
                <summary className="cursor-pointer font-semibold text-ink marker:text-sign">
                  {t.title}{" "}
                  <span className="num font-normal text-ink-soft">
                    ({chats.filter((c) => c.passed).length}/{chats.length} passed)
                  </span>
                </summary>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {chats.map((c) => {
                    const turns = run.transcripts[c.id] ?? [];
                    const said = turns.map((x) => `“${x.message}”`).join(" → ") || c.id;
                    return (
                      <li key={c.id}>
                        {c.passed ? (
                          <p>
                            <span className="font-semibold text-sign" aria-hidden>
                              ✓
                            </span>
                            <span className="sr-only">Passed:</span>{" "}
                            {said}
                          </p>
                        ) : (
                          <details>
                            <summary className="cursor-pointer">
                              <span className="font-semibold text-chilli" aria-hidden>
                                ✗
                              </span>
                              <span className="sr-only">Failed:</span>{" "}
                              {said}
                            </summary>
                            <div className="mt-1.5 border-l-2 border-chilli pl-3">
                              <p className="text-ink-soft">{c.failures.map((f) => `${CATEGORY[f.category] ?? f.category}: ${f.detail}`).join("; ")}</p>
                              <ol className="mt-2 space-y-2">
                                {turns.map((x, i) => (
                                  <li key={i}>
                                    <p>
                                      <span className="font-semibold">Shopper:</span> {x.message}
                                    </p>
                                    <p>
                                      <span className="font-semibold">Jhola</span> ({x.status}, {x.model_calls} model call{x.model_calls === 1 ? "" : "s"}, {secs(x.ms)}): {x.reply}
                                      {x.question ? ` (asked: ${x.question})` : ""}
                                    </p>
                                    <p className="text-ink-soft">
                                      ₹{x.total}: {x.lines.join("; ") || "empty cart"}
                                    </p>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      </section>
    </>
  );
}

