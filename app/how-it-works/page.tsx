import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { REPO_URL, SiteFooter } from "@/components/SiteFooter";
import { SignHeadline, SiteHeader } from "@/components/SiteHeader";
import { button, H2, H3, StatBoard, Steps } from "@/components/ui";
import type { ChatSummary } from "@/evals/chatScore";
import { LATEST_FILE } from "@/evals/history";
import { pct, secs } from "@/components/format";
import { catalog } from "@/lib/catalog";
import report from "@/data/catalog/report.json";
import { isFood } from "@/lib/schema";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Jhola, an AI shopping agent, turns one sentence into a ready cart and edits it in chat: the model decides what's needed, a solver in code picks products, packs and prices, every cart is checked, and evals measure every change.",
};

function read<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf8")) as T;
  } catch {
    return null;
  }
}
/** The latest full run of the final eval (the one /results shows), read at build time. */
function latestChatRun(): { summary: ChatSummary; date: string } | null {
  try {
    const run = JSON.parse(fs.readFileSync(path.join(process.cwd(), LATEST_FILE), "utf8"));
    return { summary: run.summary, date: String(run.meta.ran_at).slice(0, 10) };
  } catch {
    return null;
  }
}

const AGENT = [
  {
    title: "Understand",
    body: "The agent's first tool call says what it understood (“Pasta night, 4 people, vegetarian, around ₹600”) and records standing rules like “No onions”. It streams, so that line is on screen while the model is still writing the plan. It asks a question only when two readings would give clearly different carts, and builds anyway.",
  },
  {
    title: "Plan the needs",
    body: `It writes what the request needs, not products: penne, 100 g a person, for the pasta; fresh cream, a guess, for the sauce. It reads a compact index of the ${report.kinds} kinds of grocery in stock, with the words shoppers use for each ("dahi", "cold drink") and their usual pack sizes, so it plans with real kinds without searching.`,
  },
  {
    title: "Solve, in code",
    body: "A solver turns the plan into a cart in under a millisecond: only in-stock products that fit the diet and every rule, whole packs that cover each amount, the best fit for the chosen quality, and an exact knapsack over rupees when there's a budget. It records how it picked each line.",
  },
  {
    title: "Check, then act on what happened",
    body: "Every change re-solves the cart and re-checks it independently: stock, prices, amounts for the head count, budget, diet, every rule, duplicates. The agent reads the verdict and keeps going (trying options with what_if, browsing a kind, asking) until the checks pass. Once the cart is right, code ends the turn and writes the reply, with no extra model call.",
  },
  {
    title: "Show its work",
    body: "Each line says why it's there and how it was picked. A checklist sits above the cart, swaps for sold-out items are marked, an end note says what it guessed or couldn't find, and every reply shows its time, steps and cost, with the full trace a tap away.",
  },
];

const GUARANTEES = [
  {
    title: "Valid by construction",
    body: "Products the diet or a rule excludes are never candidates, so “no onions” can't come back on a later turn. Prices and totals come from the catalog in one place. The model never sets a product, pack or price.",
  },
  {
    title: "Edits change only what you asked",
    body: "Each need keeps its product while it still fits, so “make it 6 people” changes pack counts, not brands. Your own swaps are pinned and kept. The eval measures every line an edit changed that nobody asked about.",
  },
  {
    title: "Recovers, doesn't drop",
    body: "When a pick sells out, the solver takes the closest in-stock match of the same kind and form and says so: “D'Lecta cheese cubes are out of stock, so I picked Amul cheese slices, same size, ₹21 more”. When you order, the server solves the cart again, so the order's total always uses current stock and prices.",
  },
  {
    title: "Safe by design",
    body: "The agent has no tool to order or pay: it can't, whatever it's told. Only you can press “Looks good, I'm done”, and even that is a demo: nothing is bought or charged. Big changes wait for your yes. Catalog text is fenced as data, and a listing with planted instructions is flagged and ignored. Phone numbers and emails are masked before anything is stored.",
  },
];

const STACK = [
  ["Next.js + TypeScript", "the page, the streaming API and the solver, in one codebase"],
  ["gpt-5.4-mini via OpenRouter", "strict tool calls, streamed, checked again with Zod"],
  ["A solver in TypeScript", "an exact knapsack and stock recovery, property-tested with fast-check"],
  ["PostgreSQL", "every turn with its cart and a trace of each model and tool call, votes, orders with their ratings, and shared carts"],
  ["Upstash Redis", "rate limits and a 30-day cache of first answers"],
  ["Vitest + GitHub Actions", "350+ tests on every PR, a real-model eval check on request, a deploy on every merge"],
  ["Own Ubuntu server", "nginx with HTTPS in front, Node.js kept running by systemd"],
];

export default function HowItWorks() {
  const run = latestChatRun();
  const s = run?.summary;
  const bench = read<{ sessions: number; valid_rate: number; within_budget_when_possible: number | null; stable_rate: number; ms_p50: number }>("evals/solver/latest.json");
  const food = catalog.filter(isFood).length;
  const metrics: [string, string, string][] = [
    ...(s
      ? ([
          ["Carts ready to order", pct(s.ready_to_order ?? null), `of ${s.scenarios} scripted chats`],
          ["Scenarios passed", `${s.passed} / ${s.scenarios}`, "new chats, edits, diets, budgets, memory, stock, safety"],
          ["Rule breaks", String(s.rule_breaks), "in every turn's cart"],
          ["Edits that changed only what was asked", pct(s.collateral_free), "lines nobody asked about stayed put"],
          ["Typical turn", secs(s.latency_p50_ms), `${s.model_calls_median} model call${s.model_calls_median === 1 ? "" : "s"} (median), ${pct(s.finished_by_code)} ended by code`],
        ] as [string, string, string][])
      : []),
    ...(bench
      ? ([
          ["Solver: valid carts", pct(bench.valid_rate), `${bench.sessions.toLocaleString("en-IN")} random sessions, ${bench.ms_p50} ms each`],
          ["Solver: within budget when possible", pct(bench.within_budget_when_possible), `stable on re-solve ${pct(bench.stable_rate)}`],
        ] as [string, string, string][])
      : []),
  ];
  const DATA = [
    {
      title: "Every turn, logged",
      body: "Each turn goes into Postgres with the cart before and after and a trace of every model and tool call: timing, tokens and errors. Writes happen after the answer is sent, so a slow database never slows a reply.",
    },
    {
      title: "Every run, in public",
      body: "A run succeeds when the shopper presses “Looks good, I'm done”. History lists every run with how it ended, its rating and comment, its cost and time, and a trace of every model and tool call, next to the last 30 days' charts. Chat messages stay private behind an admin key, and visitors are a daily code that can't be traced back.",
      link: { href: "/history", text: "See every run" },
    },
    {
      title: "A grocery catalogue checked by code",
      body: `${catalog.length.toLocaleString("en-IN")} grocery products in ${report.kinds} kinds (${food.toLocaleString("en-IN")} food and drink, ${(catalog.length - food).toLocaleString("en-IN")} household, cleaning, personal, baby and pet care), kept in one CSV file. A build checks every row: stable IDs, honest diet tags, what each food contains (dairy, gluten, nuts and more, so "no dairy" is a hard rule), and at least 3 choices in stock for every kind. A coverage check confirms that 130+ everyday grocery requests can be filled. Prices are approximate (${report.prices_as_of}).`,
    },
    {
      title: "Shareable carts",
      body: "A share link stores the chat's brief, needs and pins, not a frozen list: opening it solves the cart again against today's stock and prices.",
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader current="how">
        <SignHeadline title="The model reasons. Code guarantees.">
          <p>
            Jhola is an AI shopping agent you chat with. It turns one sentence into a ready cart of groceries and household items from {catalog.length.toLocaleString("en-IN")} real products,
            then changes it as you ask. The model decides what you need; a solver in code decides which products, how many and what it costs, so every cart is in stock, in budget and true to your
            rules.
          </p>
          <Link href="/" className={button("secondary", "mt-6 inline-block px-5 py-3")}>
            Try it: build a cart
          </Link>
        </SignHeadline>
      </SiteHeader>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-14 sm:px-6">
        <section aria-labelledby="loop" className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-14">
          <div>
            <h2 id="loop" className={H2}>One chat, one cart</h2>
            <p className="mt-3 max-w-md leading-relaxed text-ink-soft">
              The agent plans, acts through tools, reads what really happened and acts again, until its own checks pass. Most turns take one or two model calls, because code ends a turn itself
              once the cart is right.
            </p>
          </div>
          <Steps steps={AGENT} />
        </section>

        <section aria-labelledby="code" className="mt-14 grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-14">
          <div>
            <h2 id="code" className={H2}>What code guarantees</h2>
            <p className="mt-3 max-w-md leading-relaxed text-ink-soft">The parts that must never go wrong don&apos;t depend on the model getting them right.</p>
          </div>
          <Steps steps={GUARANTEES} numbered={false} />
        </section>

        {metrics.length > 0 && (
          <section aria-labelledby="measured" className="mt-14">
            <h2 id="measured" className={H2}>Measured, not guessed</h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-ink-soft">
              {s?.scenarios ?? "About 100"} scripted chats run against the real model and are checked in code, with no AI judge{run ? ` (latest run ${run.date})` : ""}. A pull request that changes the agent
              can run a 37-chat subset on request, which fails if it breaks a rule.
            </p>
            <div className="mt-6">
              <StatBoard items={metrics} />
            </div>
            <Link href="/results" className={button("quiet", "mt-6 inline-block")}>
              See accuracy over time, every result and every failure
            </Link>
          </section>
        )}

        <section aria-labelledby="data" className="mt-14 grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-14">
          <div>
            <h2 id="data" className={H2}>The data behind it</h2>
            <p className="mt-3 max-w-md leading-relaxed text-ink-soft">What the live site records, how it&apos;s checked, and where the products come from.</p>
          </div>
          <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {DATA.map((d) => (
              <li key={d.title} className="border-t-[3px] border-sign pt-3">
                <h3 className={`text-lg ${H3}`}>{d.title}</h3>
                <p className="mt-1 leading-relaxed text-ink-soft">{d.body}</p>
                {d.link && (
                  <Link href={d.link.href} className={button("quiet", "mt-2 inline-block")}>
                    {d.link.text}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="stack" className="mt-14 grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-14">
          <div>
            <h2 id="stack" className={H2}>Built with</h2>
            <p className="mt-3 max-w-md leading-relaxed text-ink-soft">
              The full design and how each part is tested are in the{" "}
              <a href={`${REPO_URL}#readme`} className={button("quiet")}>
                README
              </a>
              .
            </p>
          </div>
          <dl className="divide-y divide-line border-y-2 border-sign">
            {STACK.map(([name, why]) => (
              <div key={name} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
                <dt className="font-semibold text-ink">{name}</dt>
                <dd className="text-ink-soft">{why}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-14">
          <Link href="/" className={button("primary", "inline-block px-5 py-3")}>
            Try it: build a cart
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
