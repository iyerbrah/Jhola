import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clock, count, dayTime, pct, rupees, rupeesExact, secs, starText, usd } from "@/components/format";
import { OutcomeTag } from "@/components/history/OutcomeTag";
import { SiteFooter } from "@/components/SiteFooter";
import { SignHeadline, SiteHeader } from "@/components/SiteHeader";
import { button, CARD, H2, H3, Notice, StatBoard, tag, type Tone } from "@/components/ui";
import { adminKey } from "@/lib/admin";
import { USD_TO_INR } from "@/lib/cost";
import { defaultRequestLog } from "@/lib/log/requestLog";
import { publicRun, SESSION_ID, type RunDetail, type TurnView } from "@/lib/log/runs";
import { isUnlocked } from "../access";
import { KeyForm, LockButton } from "@/components/history/KeyForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "A run", robots: { index: false } };

const STATUS: Record<string, [string, Tone]> = {
  done: ["Done", "good"],
  confirm: ["Asked to confirm", "warn"],
  gave_up: ["Gave up", "bad"],
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SESSION_ID.test(id)) notFound();
  let full: RunDetail | null = null;
  let down = false;
  try {
    full = await defaultRequestLog().run(id);
  } catch (err) {
    console.error("[history] couldn't read a run:", err instanceof Error ? err.message : err);
    down = true;
  }
  if (!down && !full) notFound();

  const unlocked = await isUnlocked();
  // Private parts reach the page only after the key; otherwise they're taken out here, before rendering.
  const run = full && (unlocked ? full : publicRun(full));
  const keyOn = adminKey() != null;
  const s = run?.summary;
  const o = s?.order;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader current="history">
        <SignHeadline title={o?.name ? `${o.name}'s run` : "A run"}>
          {s && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <time dateTime={s.started_at}>{dayTime(s.started_at)}</time>
              <OutcomeTag run={s} onSign />
            </p>
          )}
        </SignHeadline>
      </SiteHeader>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 sm:px-6">
        <p>
          <Link href="/history" className={button("quiet")}>
            Back to History
          </Link>
        </p>
        {down || !run || !s ? (
          <Notice tone="warn">The request log can&apos;t be reached right now. Try again in a minute.</Notice>
        ) : (
          <>
            {o && (
              <section aria-labelledby="order" className="mt-8">
                <h2 id="order" className={H2}>
                  The order
                </h2>
                <div className={`mt-4 ${CARD}`}>
                  <p className="num flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="font-sign text-[1.75rem] leading-none text-ink">{rupees(o.total)}</span>
                    <span className="text-ink-soft">
                      {o.items} item{o.items === 1 ? "" : "s"}, order {o.number}, after {o.messages} message{o.messages === 1 ? "" : "s"}
                    </span>
                    <span className={o.failed_checks ? "font-semibold text-chilli" : "font-semibold text-sign"}>
                      {o.failed_checks ? `${o.failed_checks} check${o.failed_checks === 1 ? "" : "s"} failed` : "✓ Every check passed"}
                    </span>
                  </p>
                  {o.stars != null ? (
                    <figure className="mt-5 border-l-4 border-turmeric pl-4">
                      <p className="text-2xl text-turmeric-text" role="img" aria-label={`${o.stars} of 5 stars`}>
                        {starText(o.stars)}
                      </p>
                      {o.comment && <blockquote className="mt-2 max-w-2xl text-lg text-ink">{o.comment}</blockquote>}
                      <figcaption className="mt-2 text-sm text-ink-soft">{o.name ?? "Anonymous"}</figcaption>
                    </figure>
                  ) : (
                    <p className="mt-4 text-ink-soft">The shopper didn&apos;t leave a rating.</p>
                  )}
                  {o.private && (
                    <div className="mt-5 border-t border-line pt-4">
                      {o.private.failed.length > 0 && <p className="text-sm text-chilli">Failed: {o.private.failed.join(", ")}</p>}
                      <OrderLines lines={o.private.lines} />
                    </div>
                  )}
                </div>
              </section>
            )}

            <div className={o ? "mt-14" : "mt-8"}>
              <StatBoard
                cols={6}
                items={[
                  ["Cost", rupeesExact(s.cost_usd * USD_TO_INR), usd(s.cost_usd)],
                  ["Time answering", secs(s.latency_ms), s.turns > 1 ? `slowest turn ${secs(s.slowest_ms)}` : undefined],
                  ["Turns", String(s.turns), s.code_finished ? `${s.code_finished} ended by code` : undefined],
                  ["Model calls", String(s.model_calls)],
                  ["Tool calls", String(s.tool_calls)],
                  ["Tokens", count(s.input_tokens + s.output_tokens), `${count(s.input_tokens)} in (${count(s.cached_tokens)} cached), ${count(s.output_tokens)} out`],
                ]}
              />
            </div>

            <section aria-labelledby="private" className="mt-14">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 id="private" className={H2}>
                  Messages and cart
                </h2>
                {unlocked && <LockButton />}
              </div>
              {unlocked ? (
                <p className="mt-2 text-ink-soft">Shown below in each turn, with the cart it left. The shopper&apos;s brief: {run.private?.brief || "none recorded"}.</p>
              ) : keyOn ? (
                <div className="mt-3 max-w-xl rounded-md border-2 border-dashed border-ink-soft bg-paper p-5">
                  <p className="mb-4 text-ink-soft">What the shopper and Jhola wrote, the products in the cart and error text are private. Enter the admin key to see them.</p>
                  <KeyForm />
                </div>
              ) : (
                <Notice>Messages are private, and the admin key isn&apos;t set on this site, so they can&apos;t be shown.</Notice>
              )}
            </section>

            <section aria-labelledby="turns" className="mt-14">
              <h2 id="turns" className={H2}>
                Turns
              </h2>
              {run.turns.length === 0 ? (
                <p className="mt-3 text-ink-soft">No chat turns were logged for this run.</p>
              ) : (
                <ol className="mt-4 space-y-5">
                  {run.turns.map((t, i) => (
                    <Turn key={t.id} turn={t} n={i + 1} />
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function Turn({ turn: t, n }: { turn: TurnView; n: number }) {
  const [label, tone] = STATUS[t.status] ?? [t.status, "neutral" as Tone];
  const p = t.private;
  return (
    <li className={CARD}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className={H3}>Turn {n}</h3>
        <time dateTime={t.at} className="num text-sm text-ink-soft">
          {clock(t.at)}
        </time>
        <span className={tag(tone)}>{label}</span>
        {t.ready != null && (
          <span className={tag(t.ready ? "good" : "bad")}>
            {t.ready ? "Ready to order" : t.failed_checks ? `Not ready: ${t.failed_checks} check${t.failed_checks === 1 ? "" : "s"} failed` : "Not ready"}
          </span>
        )}
        {t.cached && <span className={tag("neutral")}>From the cache</span>}
      </div>

      {p && (
        <div className="mt-4 space-y-3">
          <p className="max-w-[85%] rounded-md bg-sign px-3 py-2 text-on-sign">{p.message}</p>
          <p className="max-w-prose text-ink">{p.reply || <span className="text-ink-soft">No reply.</span>}</p>
          {p.not_ready.length > 0 && (
            <div className="rounded-r-md border-l-4 border-chilli bg-chilli-soft px-3 py-2 text-sm text-ink">
              <p className="font-semibold">Why it wasn&apos;t ready</p>
              <ul className="mt-1 list-disc pl-5">
                {p.not_ready.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <dl className="num mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4 lg:grid-cols-7">
        <Fact label="Time" value={secs(t.latency_ms)} />
        <Fact label="Cost" value={usd(t.cost_usd)} />
        <Fact label="Calls" value={`${t.model_calls ?? 0} model, ${t.tool_calls ?? 0} tool`} />
        <Fact label="Tokens in" value={`${count(t.input_tokens)}${t.cached_tokens ? ` (${count(t.cached_tokens)} cached)` : ""}`} />
        <Fact label="Tokens out" value={count(t.output_tokens)} />
        <Fact label="Cart after" value={t.cart ? `${rupees(t.cart.total)}, ${t.cart.items} items` : "–"} />
        <Fact label="Helpful?" value={t.up || t.down ? `${t.up} yes, ${t.down} no` : "–"} />
      </dl>
      {t.finished_by === "code" && <p className="mt-2 text-sm text-ink-soft">Code checked the cart and wrote the reply: no extra model call to finish.</p>}

      {t.steps.length > 0 && <Trace turn={t} />}

      {p && p.lines.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">The cart after this turn ({p.lines.filter((l) => l.included).length} items)</summary>
          <table className="mt-2 w-full text-left text-sm">
            <tbody className="num">
              {p.lines.map((l, i) => (
                <tr key={`${l.product_id}:${i}`} className={`border-t border-line ${l.included ? "" : "text-ink-soft"}`}>
                  <td className="py-1.5 pr-3">
                    {l.name}
                    {!l.included && " (not counted)"}
                  </td>
                  <td className="py-1.5 pr-3 text-right">× {l.qty}</td>
                  <td className="py-1.5 text-right">{rupees(l.price * l.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}

/** Every model and tool call in the turn, in order, with a bar for its share of the turn's time. */
function Trace({ turn: t }: { turn: TurnView }) {
  const longest = Math.max(1, ...t.steps.map((s) => s.ms));
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className={`mb-1 text-left ${H3}`}>Trace</caption>
        <thead className="text-ink-soft">
          <tr>
            <th className="py-1 pr-3 font-semibold">Step</th>
            <th className="py-1 pr-3 font-semibold">Call</th>
            <th className="py-1 pr-3 font-semibold">Result</th>
            <th className="w-[30%] py-1 pr-3 font-semibold">Time</th>
            <th className="py-1 text-right font-semibold">Tokens in / out</th>
          </tr>
        </thead>
        <tbody className="num">
          {t.steps.map((s, i) => (
            <tr key={i} className="border-t border-line align-top">
              <td className="py-1.5 pr-3 text-ink-soft">{s.kind === "model" ? "Model" : "Tool"}</td>
              <td className="py-1.5 pr-3 font-semibold text-ink">{s.name}</td>
              <td className={`py-1.5 pr-3 ${s.ok ? "text-sign" : "font-semibold text-chilli"}`}>
                {s.ok ? "OK" : "Error"}
                {s.private?.error && <span className="block font-normal text-ink">{s.private.error}</span>}
              </td>
              <td className="py-1.5 pr-3">
                <span className="flex items-center gap-2">
                  <span className="h-2 rounded-full bg-sign" style={{ width: `${Math.max(2, (s.ms / longest) * 100)}%` }} aria-hidden />
                  <span className="whitespace-nowrap">{s.ms < 1000 ? `${s.ms} ms` : secs(s.ms)}</span>
                </span>
              </td>
              <td className="py-1.5 text-right whitespace-nowrap">{s.kind === "model" ? `${count(s.input_tokens)} / ${count(s.output_tokens)}` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-sm text-ink-soft">
        {pct(t.latency_ms ? t.steps.reduce((a, s) => a + s.ms, 0) / t.latency_ms : null)} of the turn&apos;s time is in these steps; the rest is streaming and solving.
      </p>
    </div>
  );
}

function OrderLines({ lines }: { lines: { product_id: string; name: string; qty: number; price: number }[] }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-ink">What was ordered ({lines.length} items)</summary>
      <table className="mt-2 w-full text-left text-sm">
        <tbody className="num">
          {lines.map((l) => (
            <tr key={l.product_id} className="border-t border-line">
              <td className="py-1.5 pr-3">{l.name}</td>
              <td className="py-1.5 pr-3 text-right">× {l.qty}</td>
              <td className="py-1.5 text-right">{rupees(l.price * l.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
