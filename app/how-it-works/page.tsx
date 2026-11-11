import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { REPO_URL, SiteFooter } from "@/components/SiteFooter";
import type { AgentSummary } from "@/evals/agentScore";
import type { Summary } from "@/evals/score";
import { catalog } from "@/lib/catalog";
import { isFood } from "@/lib/schema";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Jhola turns one sentence into three priced carts and edits them in chat: the model picks, code checks and counts, every request is logged in Postgres, and evals gate every change.",
};

/** The newest full run in an eval results folder (read once, at build time), or null. */
function latestRun<T>(folder: string, isFull: (run: { meta?: { scenarios?: number }; summary: T }) => boolean): { summary: T; date: string } | null {
  try {
    const dir = path.join(process.cwd(), folder);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !/-[a-z_]+\.json$/.test(f)) // skip single-group runs like "-edge"
      .sort()
      .reverse();
    for (const f of files) {
      const run = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (isFull(run)) return { summary: run.summary, date: f.slice(0, 10) };
    }
    return null;
  } catch {
    return null;
  }
}

const latestEval = () => latestRun<Summary>("evals/results", () => true);
// Agent runs saved with fewer than 20 scenarios are spot checks, not the full eval.
const latestAgentEval = () => latestRun<AgentSummary>("evals/agent/results", (r) => (r.meta?.scenarios ?? 0) >= 20);

const STEPS = [
  {
    title: "Plan",
    body: "One model call reads the request and decides three genuinely different carts (by price tier, cooking style or dish), each as a plain shopping list with amounts: “paneer 400 g; tomato 500 g…”. It sees only a short index of the kinds of product the store stocks, not every product, and names the kinds each cart needs. It also reads any budget, item count or main ingredient every cart must have, and says no to things the store doesn't sell.",
  },
  {
    title: "Pick products, three at once",
    body: "Three model calls run in parallel, one per cart. Each sees only the products of the kinds its list needs, from cheapest to priciest, and maps its list to product IDs and how much of each is needed. A budget turns into a spend limit for each cart.",
  },
  {
    title: "Code does the maths",
    body: "Code turns amounts into whole packs (400 g of 200 g packs is 2) and picks the cheapest pack size that covers them (a 1 kg bag of rice for 400 g, not 5 kg). It also merges duplicate lines, swaps out-of-stock picks for a twin, marks pantry staples optional, fits carts to the budget and makes near-identical carts different.",
  },
  {
    title: "Check every rule",
    body: "Every product must exist and be in stock, quantities must be 1 to 10, budgets and counts must hold, every cart must contain the dish's main ingredient, and no two carts can share 70% of their products. Only a cart that still breaks a rule goes back to the model, once.",
  },
  {
    title: "Price from the catalog",
    body: "Prices and totals come from the catalog, never from the model, so an invented product or price can't reach the screen.",
  },
];

const AGENT_STEPS = [
  {
    title: "Tools, not free text",
    body: "Under the carts, the shopper asks for a change in plain words: “make it vegetarian”, “keep it under ₹450”, “I already have rice”. A model works only through tools (search, add, remove, swap, quantity, cheapen, fit a diet, set a requirement), and each tool checks its arguments and takes prices from the catalog.",
  },
  {
    title: "Code decides what may change",
    body: "Code works out from the shopper's words which carts a turn may touch. Code also does the mechanical edits: fitting a budget with cheaper packs, swapping items to fit a diet by kind, and keeping the amount the same when a product is swapped.",
  },
  {
    title: "Every rule, before the reply",
    body: "A turn can't finish while a changed cart breaks a rule (stock, budget, diet, the dish's main ingredient, item counts), and its reply can't mention a total it never reached. A turn that hits its limits (16 tool calls, 6 model calls, 25 seconds) leaves the carts as they were.",
  },
  {
    title: "Shown as it happens, with Undo",
    body: "Each step streams to the screen (“Searching for paneer…”), then a list of what changed and the new totals, with Undo and a 👍/👎.",
  },
];

const STACK = [
  ["Next.js + TypeScript", "one app for the page and the API"],
  ["gpt-5.4-mini via OpenRouter", "structured JSON output and tool calls, checked with Zod"],
  ["PostgreSQL", "every build and agent turn with its trace, the 👍/👎 votes, and the live stats"],
  ["Upstash Redis", "rate limits and a 30-day answer cache"],
  ["Tailwind CSS", "styling, with every colour pair checked for WCAG AA"],
  ["Vitest + GitHub Actions", "unit tests on every PR, a real-model eval check on request, and a deploy on every merge"],
  ["Own Ubuntu server", "nginx with Let's Encrypt HTTPS in front, Node.js kept running by systemd"],
];

const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);

type Metric = [label: string, value: string, note: string];

function Steps({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={step.title} className="flex gap-4 rounded-2xl border-2 border-line bg-paper p-5">
          <span className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg text-on-ink" aria-hidden>
            {i + 1}
          </span>
          <div>
            <h3 className="text-lg font-bold text-ink">{step.title}</h3>
            <p className="mt-1 text-ink-soft">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Metrics({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map(([label, value, note]) => (
        <div key={label} className="rounded-2xl border-2 border-ink bg-paper px-5 py-4 shadow-lift">
          <dt className="text-sm text-ink-soft">{label}</dt>
          <dd className="num mt-1 font-display text-3xl leading-tight text-ink">{value}</dd>
          <dd className="mt-1 text-sm text-ink-soft">{note}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function HowItWorks() {
  const run = latestEval();
  const s = run?.summary;
  const metrics: Metric[] = s
    ? [
        ["Valid after at most one repair", pct(s.valid_after_repair), "every product real and in stock, every rule met"],
        ["Budgets and item counts met", pct(s.constraints_met), "in all three carts"],
        ["Ingredients covered", pct(s.ingredient_coverage), "the key items each request needs"],
        ["Carts distinct", s.mean_jaccard == null ? "n/a" : `${Math.round((1 - s.mean_jaccard) * 100)}% different`, "average product overlap between carts"],
        ["Edge cases handled", s.edge_status_correct, "sushi, a laptop, a one-word query, a long query, a prompt injection"],
        ["Typical time", `${s.latency_p50_s.toFixed(1)} s`, `95% of answers within ${s.latency_p95_s.toFixed(1)} s`],
        ["Cost per answer", s.avg_cost_usd == null ? "n/a" : `$${s.avg_cost_usd.toFixed(3)}`, "four model calls, mostly from cached prompt"],
      ]
    : [];
  const agentRun = latestAgentEval();
  const a = agentRun?.summary;
  const agentMetrics: Metric[] = a
    ? [
        ["Scenarios passed", pct(a.task_success), `${a.passed} of ${a.scenarios}: diets, budgets, swaps, questions, two-turn chats`],
        ["Rule breaks in changed carts", String(a.rule_breaks), "stock, budget, diet, main ingredient, item counts"],
        ["Questions and impossible asks", a.no_change_ok, "that changed nothing, as they shouldn't"],
        ["Typical turn", `${a.latency_p50_s.toFixed(1)} s`, `95% of turns within ${a.latency_p95_s.toFixed(1)} s`],
        ["Cost per turn", a.cost_per_turn == null ? "n/a" : `$${a.cost_per_turn.toFixed(4)}`, `${a.model_calls_per_turn.toFixed(1)} model calls a turn on average`],
      ]
    : [];
  const food = catalog.filter(isFood).length;
  const DATA = [
    {
      title: "Every request, logged",
      body: "Each cart build and agent turn goes into Postgres with its carts and a trace of every model and tool call: timing, tokens and errors. Writes happen after the answer is sent, so a slow database never slows a request.",
    },
    {
      title: "Feedback on every answer",
      body: "A 👍/👎 on each cart and each agent reply is stored against the request it rates, so a bad answer can be traced back to the calls that made it.",
    },
    {
      title: "Live numbers, in public",
      body: "The stats page computes volume, speed, reliability, cost and feedback for the last 30 days straight from that log, in SQL. It shows totals only: no request text, and visitors are a daily code that can't be traced back.",
      link: { href: "/stats", text: "See the live stats" },
    },
    {
      title: "A catalog built and checked by code",
      body: `${catalog.length.toLocaleString("en-IN")} products (${food.toLocaleString("en-IN")} food, ${(catalog.length - food).toLocaleString("en-IN")} household and personal care) built from a public BigBasket dataset by a tested pipeline. IDs stay stable across rebuilds, misfilings are caught by rules (cheese must be dairy), and every build writes a quality report.`,
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <div className="hero-band">
        <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <header className="flex items-center justify-between py-5">
            <Link href="/" className="font-display text-3xl leading-none text-on-ink">
              Jhola
            </Link>
            <Link href="/" className="text-sm font-semibold text-on-ink underline decoration-marigold decoration-2 underline-offset-4">
              Build carts
            </Link>
          </header>
          <h1 className="rise mt-8 max-w-3xl font-display text-5xl leading-[1.05] text-on-ink sm:text-6xl">The model picks. Code counts.</h1>
          <p className="rise mt-5 max-w-2xl text-lg leading-relaxed text-on-ink-soft" style={{ "--i": 1 } as React.CSSProperties}>
            Jhola turns one sentence into three ready-to-order carts from {catalog.length.toLocaleString("en-IN")} real Indian groceries and household essentials. A
            language model chooses what goes in each cart; ordinary code checks every choice and does all the maths, so the app never shows an invented
            product or price.
          </p>
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <section className="mt-12 grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="font-display text-3xl text-ink">From one line to three carts</h2>
            <p className="mt-3 max-w-md text-ink-soft">
              Splitting the work keeps answers fast: each cart call writes a third of the output, and all three run at the same time. Everything
              mechanical is done in code, where it is instant, exact and tested.
            </p>
          </div>
          <Steps steps={STEPS} />
        </section>

        <section className="mt-16 grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="font-display text-3xl text-ink">Then change a cart by asking</h2>
            <p className="mt-3 max-w-md text-ink-soft">
              The cart editor is an agent: a model that plans and calls tools in a loop. The same rule holds: the model decides, code checks. Most
              turns take one or two model calls, because code finishes a turn itself once its edits pass every rule.
            </p>
          </div>
          <Steps steps={AGENT_STEPS} />
        </section>

        {(run || agentRun) && (
          <section className="mt-16">
            <h2 className="font-display text-3xl text-ink">Measured, not guessed</h2>
            <p className="mt-3 max-w-2xl text-ink-soft">
              Two evaluations run the real model and score every answer in code. A pull request that changes answers runs a subset of each, on request,
              and fails if the scores drop below the saved baseline.
            </p>
            {run && s && (
              <>
                <h3 className="mt-8 text-lg font-bold text-ink">Cart builder</h3>
                <p className="text-ink-soft">
                  {s.cases} requests: recipes, meal ideas, budgets and gifts, household shopping and edge cases. Latest run: {run.date}.
                </p>
                <Metrics metrics={metrics} />
              </>
            )}
            {agentRun && a && (
              <>
                <h3 className="mt-8 text-lg font-bold text-ink">Cart editor agent</h3>
                <p className="text-ink-soft">
                  {a.scenarios} scripted conversations from saved carts, with the final carts checked in code. Latest run: {agentRun.date}.
                </p>
                <Metrics metrics={agentMetrics} />
              </>
            )}
          </section>
        )}

        <section className="mt-16 grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="font-display text-3xl text-ink">The data behind it</h2>
            <p className="mt-3 max-w-md text-ink-soft">
              What the live site records, how it&apos;s checked, and where the products come from.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {DATA.map((d) => (
              <li key={d.title} className="rounded-2xl border-2 border-line bg-paper p-5">
                <h3 className="text-lg font-bold text-ink">{d.title}</h3>
                <p className="mt-1 text-ink-soft">{d.body}</p>
                {d.link && (
                  <Link href={d.link.href} className="mt-2 inline-block font-semibold text-ink underline decoration-marigold decoration-2 underline-offset-4">
                    {d.link.text}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16 grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="font-display text-3xl text-ink">Built with</h2>
            <p className="mt-3 max-w-md text-ink-soft">
              The full design, the eval history and what each change improved are in the{" "}
              <a href={`${REPO_URL}#readme`} className="font-semibold text-ink underline underline-offset-4">
                README
              </a>
              .
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {STACK.map(([name, why]) => (
              <li key={name} className="rounded-2xl bg-paper px-5 py-4">
                <p className="font-bold text-ink">{name}</p>
                <p className="text-sm text-ink-soft">{why}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-14">
          <Link
            href="/"
            className="inline-block rounded-xl border-2 border-ink bg-paper px-5 py-3 font-bold text-ink shadow-[5px_5px_0_var(--color-marigold)]"
          >
            Try it: build some carts
          </Link>
        </div>

        <SiteFooter />
      </main>
    </div>
  );
}
