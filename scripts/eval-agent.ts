/**
 * The cart editor agent's eval: plays every scenario in evals/agent/scenarios.json against the real
 * model, starting from the saved carts in evals/agent/carts.json, and scores the final carts in code.
 *
 * Run: npm run eval:agent                               (all scenarios, about $0.20; saves evals/agent/results/)
 *      npm run eval:agent -- --group=diet               (one group)
 *      npm run eval:agent -- --id=paneer-jain           (one scenario)
 *      npm run eval:agent -- --ci                       (the PR check: CI subset vs evals/agent/baseline.json)
 *      npm run eval:agent -- --ci --update-baseline     (save the CI subset's run as the new baseline)
 */
import fs from "node:fs";
import path from "node:path";
import cartsJson from "../evals/agent/carts.json";
import scenariosJson from "../evals/agent/scenarios.json";
import {
  checkAgentGate,
  renderAgentReport,
  scoreScenario,
  summariseAgent,
  type AgentBaseline,
  type AgentScenario,
  type AgentSummary,
  type ScenarioScore,
  type TurnRecord,
} from "../evals/agentScore";
import { CartsInputSchema, repriceCarts, type AgentCart } from "../lib/agent/carts";
import { runAgentTurn } from "../lib/agent/loop";
import { openAiAgentModel } from "../lib/agent/model";
import type { ChatTurn } from "../lib/agent/prompt";
import { createMemorySearch } from "../lib/agent/search";
import { catalog, catalogIndex } from "../lib/catalog";
import { modelName } from "../lib/llm";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const ci = process.argv.includes("--ci");
const updateBaseline = process.argv.includes("--update-baseline");
const concurrency = Math.max(1, Number(arg("concurrency") ?? 3));
const reportPath = path.resolve(arg("report") ?? "evals/ci-agent-report.md");
const baselinePath = path.resolve(__dirname, "../evals/agent/baseline.json");

const scenarios = (scenariosJson as AgentScenario[]).filter(
  (s) => (!ci || s.ci) && (!arg("group") || s.group === arg("group")) && (!arg("id") || s.id === arg("id")),
);
const search = createMemorySearch(catalog);

function startingCarts(name: string): AgentCart[] {
  const snap = (cartsJson as Record<string, { carts: unknown }>)[name];
  if (!snap) throw new Error(`No starting carts called ${name} in evals/agent/carts.json`);
  return repriceCarts(CartsInputSchema.parse(snap.carts), catalogIndex).carts;
}

async function runScenario(s: AgentScenario): Promise<ScenarioScore> {
  const start = startingCarts(s.carts);
  let carts = start;
  const history: ChatTurn[] = [];
  const turns: TurnRecord[] = [];
  for (const message of s.turns) {
    let toolErrors = 0;
    const log = (l: Record<string, unknown>) => {
      if (l.event === "agent_step" && l.kind === "tool" && l.ok === false) toolErrors++;
    };
    const res = await runAgentTurn(
      { carts, active: s.active - 1, message, history },
      { model: openAiAgentModel, index: catalogIndex, products: catalog, search, log },
    );
    turns.push({
      message,
      status: res.status,
      stop_reason: res.stop_reason,
      reply: res.reply,
      model_calls: res.meta.model_calls,
      tool_calls: res.meta.tool_calls,
      tool_errors: toolErrors,
      latency_ms: res.meta.latency_ms,
      cost_usd: res.meta.cost_usd,
    });
    carts = res.carts;
    history.push({ role: "user", content: message }, { role: "assistant", content: res.reply });
  }
  return scoreScenario(s, start, carts, turns, catalogIndex);
}

async function runAll(list: AgentScenario[]): Promise<ScenarioScore[]> {
  const scores: ScenarioScore[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < list.length) {
      const s = list[next++];
      const score = await runScenario(s);
      scores.push(score);
      const secs = score.turns.reduce((a, t) => a + t.latency_ms, 0) / 1000;
      const calls = score.turns.map((t) => t.tool_calls).join("+");
      console.log(`[${++done}/${list.length}] ${score.passed ? "✓" : "✗"} ${secs.toFixed(1).padStart(5)}s ${calls.padStart(5)} tools  ${s.id}`);
      for (const f of score.failures) console.log(`         - ${f}`);
      if (!score.passed) console.log(`         reply: ${score.turns.at(-1)?.reply}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const order = (id: string) => list.findIndex((s) => s.id === id);
  return scores.sort((a, b) => order(a.id) - order(b.id));
}

function printSummary(s: AgentSummary) {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const rows: [string, string, string][] = [
    ["Task success", `${pct(s.task_success)} (${s.passed}/${s.scenarios})`, "≥ 90%"],
    ["Rule breaks in changed carts", String(s.rule_breaks), "0"],
    ["Scenarios that changed the wrong cart", String(s.wrong_cart_scenarios), "0"],
    ["Questions / impossible: nothing changed", s.no_change_ok, "all"],
    ["Turns that gave up", `${s.gave_up_turns} of ${s.turns}`, "report"],
    ["Tool calls / errors per turn", `${s.tool_calls_per_turn.toFixed(1)} / ${s.tool_errors_per_turn.toFixed(1)}`, "report"],
    ["Model calls per turn", s.model_calls_per_turn.toFixed(1), "report"],
    ["Latency per turn p50 / p95", `${s.latency_p50_s.toFixed(1)} s / ${s.latency_p95_s.toFixed(1)} s`, "p95 < 10 s"],
    ["Cost per turn", s.cost_per_turn == null ? "n/a" : `$${s.cost_per_turn.toFixed(4)}`, "~$0.01"],
  ];
  console.log(`\n${"Metric".padEnd(42)}${"Result".padEnd(20)}Target`);
  console.log("-".repeat(72));
  for (const [m, v, t] of rows) console.log(`${m.padEnd(42)}${v.padEnd(20)}${t}`);
  console.log(`\nBy group: ${Object.entries(s.by_group).map(([g, r]) => `${g} ${r}`).join(", ")}`);
  console.log(`Total cost $${s.total_cost_usd.toFixed(3)}`);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set: the agent eval calls the real model.");
    process.exit(1);
  }
  if (!scenarios.length) throw new Error("No scenarios match.");
  console.log(`Agent eval: ${scenarios.length} scenarios, model ${modelName()}, concurrency ${concurrency}\n`);
  let scores = await runAll(scenarios);

  let retried: string[] = [];
  if (ci) {
    retried = scores.filter((s) => !s.passed).map((s) => s.id);
    if (retried.length) {
      console.log(`\nRe-running ${retried.length} that failed once:`);
      const again = await runAll(scenarios.filter((s) => retried.includes(s.id)));
      scores = scores.map((s) => again.find((a) => a.id === s.id) ?? s);
    }
  }

  const summary = summariseAgent(scores);
  printSummary(summary);
  const ids = scenarios.map((s) => s.id);

  if (!ci) {
    const dir = path.resolve(__dirname, "../evals/agent/results");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(dir, `${stamp}${arg("group") ? `-${arg("group")}` : ""}${arg("id") ? `-${arg("id")}` : ""}.json`);
    fs.writeFileSync(file, JSON.stringify({ meta: { model: modelName(), concurrency, scenarios: ids.length }, summary, scenarios: scores }, null, 2) + "\n");
    console.log(`Saved ${path.relative(process.cwd(), file)}`);
    return;
  }

  if (updateBaseline) {
    if (summary.rule_breaks) {
      console.error("\nNot saving a baseline from a run with rule breaks.");
      process.exit(1);
    }
    const baseline: AgentBaseline = { updated: new Date().toISOString(), model: modelName(), ids, summary };
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`\nSaved ${path.relative(process.cwd(), baselinePath)}. Commit it with the change that moved the numbers.`);
    return;
  }

  let baseline: AgentBaseline | null = null;
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch {}
  const gate = checkAgentGate(summary, ids, modelName(), baseline);
  const report = renderAgentReport(gate, summary, scores, baseline, retried);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report);
  console.log(`\n${report}`);
  if (!gate.pass) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
