/**
 * npm run eval:chat: plays every chat eval scenario against the real model and scores it in code.
 * Saves evals/chat/results/<time>.json (the public /evals page reads the newest one).
 *
 *   npm run eval:chat                    # all scenarios (about 90 turns, about $0.40-0.80)
 *   npm run eval:chat -- --ci            # the PR check: the ci scenarios vs evals/chat/baseline.json (about $0.08)
 *   npm run eval:chat -- --id=pasta-night --group=edit
 *   npm run eval:chat -- --ci --update-baseline
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { catalog } from "../lib/catalog";
import { apiKeyName, modelName } from "../lib/llm";
import { runChatTurn, type ChatTurn } from "../lib/chat/loop";
import { openAiChatModel } from "../lib/chat/model";
import { allScenarios, setUp } from "../evals/chatScenarios";
import { scoreChat, summariseChat, type ChatScenario, type ChatSummary, type ScenarioScore, type TurnOutcome } from "../evals/chatScore";
import { checkChatGate, renderChatReport, type ChatBaseline } from "../evals/chatGate";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const flag = (name: string) => process.argv.includes(`--${name}`);
const ci = flag("ci");
const concurrency = Number(arg("concurrency")) || 3;
const BASELINE = "evals/chat/baseline.json";

type Transcript = { message: string; status: string; reply: string; question: string | null; total: number; lines: string[]; note: string[]; model_calls: number; ms: number };

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
  }));
  return { score: scoreChat(s, turns, setup.index), transcript };
}

async function runAll(list: ChatScenario[]) {
  const out = new Map<string, { score: ScenarioScore; transcript: Transcript[] }>();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const s = list[next++];
      try {
        const r = await play(s);
        out.set(s.id, r);
        console.log(`${r.score.passed ? "✓" : "✗"} ${s.id}${r.score.passed ? "" : `: ${r.score.failures.map((f) => `${f.check} (${f.detail})`).join("; ")}`}`);
      } catch (err) {
        console.error(`✗ ${s.id}: crashed: ${err instanceof Error ? err.message : err}`);
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
  let list = allScenarios();
  if (ci) list = list.filter((s) => s.ci);
  if (arg("id")) list = list.filter((s) => arg("id")!.split(",").includes(s.id));
  if (arg("group")) list = list.filter((s) => s.group === arg("group"));
  console.log(`Playing ${list.length} scenario(s) on ${modelName()}…`);

  const started = Date.now();
  let runs = await runAll(list);
  if (ci) {
    // A failed scenario gets one re-run, to rule out a fluke.
    const failed = runs.filter((r) => !r.score.passed).map((r) => r.id);
    if (failed.length) {
      console.log(`Re-running ${failed.length} failed scenario(s) once…`);
      const again = await runAll(list.filter((s) => failed.includes(s.id)));
      runs = runs.map((r) => again.find((a) => a.id === r.id && a.score.passed) ?? r);
    }
  }
  const scores = runs.map((r) => r.score);
  const summary: ChatSummary = summariseChat(scores, list);
  const meta = { ran_at: new Date().toISOString(), model: modelName(), ci, scenarios: list.length, catalog_size: catalog.length, wall_s: Math.round((Date.now() - started) / 1000) };

  mkdirSync("evals/chat/results", { recursive: true });
  const stamp = meta.ran_at.slice(0, 19).replace(/:/g, "-");
  const file = `evals/chat/results/${stamp}${ci ? "-ci" : ""}.json`;
  writeFileSync(file, JSON.stringify({ meta, summary, scores, transcripts: Object.fromEntries(runs.map((r) => [r.id, r.transcript])) }, null, 1) + "\n");
  const { failures, ...headline } = summary;
  console.log(headline);
  if (failures.length) console.log(`${failures.length} failed check(s); see ${file}`);
  console.log(`Saved ${file}`);

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
