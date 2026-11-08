/**
 * Runs eval cases through buildCarts() (the real pipeline and model) and scores each one.
 * Shared by scripts/eval.ts (full eval) and scripts/eval-ci.ts (the PR check).
 */
import { buildCarts } from "@/lib/buildCarts";
import { catalogIndex } from "@/lib/catalog";
import { costUsd } from "@/lib/cost";
import { scoreCase, type CaseScore, type EvalCase } from "./score";

export type RunFailure = { query: string; error: string };
export type RunResult = { scores: CaseScore[]; failures: RunFailure[] };

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

/** Runs the cases with up to `concurrency` at once, logging one line per case. Results keep the input order. */
export async function runCases(cases: EvalCase[], concurrency = 1): Promise<RunResult> {
  const scores: CaseScore[] = [];
  const failures: RunFailure[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < cases.length) {
      const c = cases[next++];
      try {
        const res = await buildCarts(c.query);
        const s = scoreCase(c, res, catalogIndex, costUsd(res.meta.model, res.meta));
        scores.push(s);
        const mark = `${s.valid ? "✓" : "✗"}${s.repaired ? "r" : " "}`;
        console.log(`[${++done}/${cases.length}] ${mark} ${(s.latency_ms / 1000).toFixed(1).padStart(5)}s  ${pad(s.status, 13)} ${c.query}`);
        for (const p of s.problems) console.log(`         - ${p}`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        failures.push({ query: c.query, error });
        console.log(`[${++done}/${cases.length}] ✗   FAILED ${c.query}: ${error}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  const order = (q: string) => cases.findIndex((c) => c.query === q);
  scores.sort((a, b) => order(a.query) - order(b.query));
  return { scores, failures };
}
