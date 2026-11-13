/**
 * npm run eval:chat: plays every chat eval scenario against the real model and scores it in code.
 * Saves evals/chat/results/<time>.json (the public /evals page reads the newest one).
 *
 *   npm run eval:chat -- --note="..."    # THE eval, with a line on what changed since the last run (shown on /results)
 *   npm run eval:chat                    # THE eval (the final suite): 105 chats, 122 turns, about $1.40, capped at $1.50
 *   npm run eval:chat -- --ci            # its PR check: 37 chats, 44 turns, about $0.50
 *   npm run eval:chat -- --suite=core    # the original eval, for deeper runs (about 95 turns, about $1.10)
 *   npm run eval:chat -- --suite=goal    # the goal suite, for deeper runs (about 95 turns, about $1.10)
 *   npm run eval:chat -- --suite=all     # every scenario of every suite (about 320 turns, about $3.70)
 *   npm run eval:chat -- --max-usd=0.5   # stop starting scenarios once this much would be spent (final defaults to 1.50)
 *   npm run eval:chat -- --id=pasta-night --group=edit
 *   npm run eval:chat -- --ci --update-baseline
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { catalog } from "../lib/catalog";
import { apiKeyName, modelName } from "../lib/llm";
import { runChatTurn, type ChatTurn } from "../lib/chat/loop";
import { openAiChatModel } from "../lib/chat/model";
import { allScenarios, setUp } from "../evals/chatScenarios";
import { EST_USD_PER_TURN, FINAL_CAP_USD, scoreChat, summariseChat, type ChatScenario, type ChatSummary, type ScenarioScore, type TurnOutcome } from "../evals/chatScore";
import { checkChatGate, renderChatReport, type ChatBaseline } from "../evals/chatGate";
import { appendHistory, HISTORY_FILE, historyEntry, LATEST_FILE, type HistoryEntry } from "../evals/history";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

/** The commit being evaluated (short hash), or null outside a git checkout. */
function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const ci = flag("ci");
const concurrency = Number(arg("concurrency")) || 3;
const BASELINE = "evals/chat/baseline.json";

/** Money spent so far this run, and money set aside for the scenarios playing now. */
const spend = { spent: 0, reserved: 0, turns: 0 };
const perTurn = () => (spend.turns ? Math.max(spend.spent / spend.turns, 0.005) : EST_USD_PER_TURN);

type Transcript = { message: string; status: string; reply: string; question: string | null; total: number; lines: string[]; note: string[]; model_calls: number; ms: number; cost_usd: number };

async function play(s: ChatScenario): Promise<{ score: ScenarioScore; transcript: Transcript[] }> {
  const setup = setUp(s, catalog);
  let session = setup.start.session;
  let before = setup.start;
  const history: ChatTurn[] = [];
  const turns: TurnOutcome[] = [];
  for (const message of s.turns) {
    const result = await runChatTurn(
      { session, message, history },
      { model: openAiChatModel, products: setup.products, index: setup.index, search: setup.search, kinds: setup.kinds, log: () => {} },
    );
    turns.push({ message, before, result });
    session = result.session;
    before = { session: result.session, cart: result.cart, checks: result.checks };
    history.push({ role: "user", content: message }, { role: "assistant", content: result.reply });
  }
  const transcript = turns.map((t) => ({
    message: t.message,
    status: t.result.status,
    reply: t.result.reply,
    question: t.result.question?.question ?? null,
    total: t.result.cart.total,
    lines: t.result.cart.lines.filter((l) => l.counted).map((l) => `${l.packs} × ${l.product.brand} ${l.product.name} ${l.product.pack_label}`),
    note: t.result.note,
    model_calls: t.result.meta.model_calls,
    ms: t.result.meta.latency_ms,
    cost_usd: t.result.meta.cost_usd ?? EST_USD_PER_TURN,
  }));
  return { score: scoreChat(s, turns, setup.index), transcript };
}

async function runAll(list: ChatScenario[], capUsd: number | null, skipped: string[]) {
  const out = new Map<string, { score: ScenarioScore; transcript: Transcript[] }>();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const s = list[next++];
      // The cost cap: a scenario starts only if its estimate fits in what's left, counting the ones still playing.
      const estimate = s.turns.length * perTurn();
      if (capUsd != null && spend.spent + spend.reserved + estimate > capUsd) {
        skipped.push(s.id);
        console.log(`- ${s.id}: skipped, it would pass the $${capUsd} cap`);
        continue;
      }
      spend.reserved += estimate;
      try {
        const r = await play(s);
        spend.spent += r.transcript.reduce((sum, t) => sum + t.cost_usd, 0);
        spend.turns += r.transcript.length;
        out.set(s.id, r);
        console.log(`${r.score.passed ? "✓" : "✗"} ${s.id}${r.score.passed ? "" : `: ${r.score.failures.map((f) => `${f.check} (${f.detail})`).join("; ")}`}`);
      } catch (err) {
        console.error(`✗ ${s.id}: crashed: ${err instanceof Error ? err.message : err}`);
      } finally {
        spend.reserved -= estimate;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return list.flatMap((s) => (out.has(s.id) ? [{ id: s.id, ...out.get(s.id)! }] : []));
}

async function main() {
  if (!process.env[apiKeyName()]) {
    console.error(`${apiKeyName()} is not set: the chat eval calls the real model.`);
    process.exit(1);
  }
  const suite = arg("suite") ?? "final";
  if (!["core", "goal", "final", "all"].includes(suite)) {
    console.error(`--suite must be final (the default), core, goal or all, not ${suite}`);
    process.exit(1);
  }
  let list = allScenarios(suite === "all" ? undefined : (suite as "core" | "goal" | "final"));
  if (ci) list = list.filter((s) => s.ci);
  if (arg("id")) list = list.filter((s) => arg("id")!.split(",").includes(s.id));
  if (arg("group")) list = list.filter((s) => s.group === arg("group"));
  const capUsd = arg("max-usd") ? Number(arg("max-usd")) : suite === "final" ? FINAL_CAP_USD : null;
  const turnCount = list.reduce((n, s) => n + s.turns.length, 0);
  console.log(
    `Playing ${list.length} scenario(s), ${turnCount} turns, on ${modelName()}: about $${(turnCount * EST_USD_PER_TURN).toFixed(2)}${capUsd != null ? `, capped at $${capUsd}` : ""}…`,
  );

  const started = Date.now();
  const skipped: string[] = [];
  let runs = await runAll(list, capUsd, skipped);
  if (ci) {
    // A failed scenario gets one re-run, to rule out a fluke.
    const failed = runs.filter((r) => !r.score.passed).map((r) => r.id);
    if (failed.length) {
      console.log(`Re-running ${failed.length} failed scenario(s) once…`);
      const again = await runAll(list.filter((s) => failed.includes(s.id)), capUsd, skipped);
      runs = runs.map((r) => again.find((a) => a.id === r.id && a.score.passed) ?? r);
    }
  }
  const scores = runs.map((r) => r.score);
  const played = list.filter((s) => runs.some((r) => r.id === s.id));
  if (!played.length) {
    console.log(skipped.length ? `Nothing played: every scenario would pass the $${capUsd} cap. Nothing saved.` : "Nothing played. Nothing saved.");
    return;
  }
  const summary: ChatSummary = summariseChat(scores, played);
  if (skipped.length) console.log(`Skipped ${skipped.length} scenario(s) to stay under $${capUsd}: ${skipped.join(", ")}`);
  console.log(`Spent about $${spend.spent.toFixed(2)} on ${spend.turns} turns.`);
  const meta = {
    ran_at: new Date().toISOString(),
    model: modelName(),
    ci,
    suite,
    spent_usd: Math.round(spend.spent * 1000) / 1000,
    cap_usd: capUsd,
    skipped,
    scenarios: played.length, catalog_size: catalog.length, wall_s: Math.round((Date.now() - started) / 1000) };

  mkdirSync("evals/chat/results", { recursive: true });
  // A full run of the final suite is the one the Results page shows: it replaces the latest run (with its
  // transcripts) and adds a point to the history. Anything else (a PR check, another suite, a few ids) is
  // saved under its own time and doesn't touch either.
  const full = suite === "final" && !ci && !arg("id") && !arg("group") && skipped.length === 0;
  const stamp = meta.ran_at.slice(0, 19).replace(/:/g, "-");
  const file = full ? LATEST_FILE : `evals/chat/results/${stamp}-${suite}${ci ? "-ci" : ""}.json`;
  const note = arg("note") ?? "";
  const commit = gitCommit();
  writeFileSync(file, JSON.stringify({ meta: { ...meta, commit, note }, summary, scores, transcripts: Object.fromEntries(runs.map((r) => [r.id, r.transcript])) }, null, 1) + "\n");
  const { failures, ...headline } = summary;
  console.log(headline);
  if (failures.length) console.log(`${failures.length} failed check(s); see ${file}`);
  console.log(`Saved ${file}`);
  if (full) {
    const history: HistoryEntry[] = existsSync(HISTORY_FILE) ? JSON.parse(readFileSync(HISTORY_FILE, "utf8")) : [];
    const next = appendHistory(history, historyEntry({ ran_at: meta.ran_at, model: meta.model, commit, note, spent_usd: meta.spent_usd, summary }));
    writeFileSync(HISTORY_FILE, JSON.stringify(next, null, 1) + "\n");
    console.log(`Added run ${next.length} to ${HISTORY_FILE}${note ? ` ("${note}")` : " (add --note=\"what changed\" next time)"}`);
  } else if (suite === "final" && !ci) {
    console.log("Not added to the history: only a complete run of the final suite counts.");
  }

  if (!ci) return;
  if (flag("update-baseline")) {
    if (summary.rule_breaks > 0) {
      console.error("Not saving a baseline from a run with rule breaks.");
      process.exit(1);
    }
    const baseline: ChatBaseline = { updated: meta.ran_at, model: meta.model, ids: list.map((s) => s.id), summary: headline };
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`Saved ${BASELINE}`);
    return;
  }
  const baseline = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, "utf8")) as ChatBaseline) : null;
  const gate = checkChatGate(summary, list.map((s) => s.id), baseline, meta.model);
  writeFileSync("evals/ci-report.md", renderChatReport(summary, gate, scores));
  console.log(gate.ok ? "Gate passed." : `Gate failed:\n- ${gate.problems.join("\n- ")}`);
  if (!gate.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
