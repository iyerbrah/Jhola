import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { REPO_URL, SiteFooter } from "@/components/SiteFooter";
import type { Summary } from "@/evals/score";
import { catalog } from "@/lib/catalog";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "How it works",
  description: "How Jhola turns one sentence into three priced grocery carts: the model picks products, code does the maths, and a 30-query eval checks it.",
};

/** The newest full eval run in evals/results (read once, at build time). */
function latestEval(): { summary: Summary; date: string; cases: number } | null {
  try {
    const dir = path.join(process.cwd(), "evals/results");
    const file = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !/-[a-z_]+\.json$/.test(f)) // skip single-group runs like "-edge"
      .sort()
      .at(-1);
    if (!file) return null;
    const run = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    return { summary: run.summary, date: file.slice(0, 10), cases: run.summary.cases };
  } catch {
    return null;
  }
}

const STEPS = [
  {
    title: "Plan",
    body: "One model call reads the request and decides three genuinely different carts (by price tier, cooking style or dish), each as a plain shopping list with amounts: “paneer 400 g; tomato 500 g…”. It also reads any budget, item count or main ingredient every cart must have, and says no to things that aren't groceries.",
  },
  {
    title: "Pick products, three at once",
    body: "Three model calls run in parallel, one per cart, each mapping its list to catalog product IDs and how much of each is needed. A budget turns into a spend limit for each cart.",
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

const STACK = [
  ["Next.js + TypeScript", "one app for the page and the API"],
  ["OpenAI gpt-5.4-mini", "structured JSON output, checked with Zod"],
  ["Upstash Redis", "rate limits, a 30-day answer cache, generation log"],
  ["Tailwind CSS", "styling, with every colour pair checked for WCAG AA"],
  ["Vitest", "unit tests with fake model answers, no live API calls"],
  ["Vercel", "hosting, deployed from GitHub on every push"],
];

const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);

export default function HowItWorks() {
  const run = latestEval();
  const s = run?.summary;
  const metrics: [string, string, string][] = s
    ? [
        ["Valid after at most one repair", pct(s.valid_after_repair), "every product real and in stock, every rule met"],
        ["Budgets and item counts met", pct(s.constraints_met), "in all three carts"],
        ["Ingredients covered", pct(s.ingredient_coverage), "the key ingredients each request needs"],
        ["Carts distinct", s.mean_jaccard == null ? "n/a" : `${Math.round((1 - s.mean_jaccard) * 100)}% different`, "average product overlap between carts"],
        ["Edge cases handled", s.edge_status_correct, "sushi, a laptop, a one-word query, a long query, a prompt injection"],
        ["Typical time", `${s.latency_p50_s.toFixed(1)} s`, `95% of answers within ${s.latency_p95_s.toFixed(1)} s`],
        ["Cost per answer", s.avg_cost_usd == null ? "n/a" : `$${s.avg_cost_usd.toFixed(3)}`, "about ₹1.5, thanks to prompt caching"],
      ]
    : [];

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
            Jhola turns one sentence into three ready-to-order grocery carts from {catalog.length.toLocaleString("en-IN")} real Indian grocery products. A
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
          <ol className="space-y-4">
            {STEPS.map((step, i) => (
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
        </section>

        {run && (
          <section className="mt-16">
            <h2 className="font-display text-3xl text-ink">Measured, not guessed</h2>
            <p className="mt-3 max-w-2xl text-ink-soft">
              A {run.cases}-query evaluation runs the real pipeline on recipes, meal ideas, budget and gift requests, and edge cases, and scores every
              answer in code. Latest run: {run.date}.
            </p>
            <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map(([label, value, note]) => (
                <div key={label} className="rounded-2xl border-2 border-ink bg-paper px-5 py-4 shadow-lift">
                  <dt className="text-sm text-ink-soft">{label}</dt>
                  <dd className="num mt-1 font-display text-3xl leading-tight text-ink">{value}</dd>
                  <dd className="mt-1 text-sm text-ink-soft">{note}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

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
