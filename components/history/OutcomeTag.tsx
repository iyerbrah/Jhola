import { rupees } from "@/components/format";
import type { RunSummary } from "@/lib/log/runs";
import { tag } from "@/components/ui";

/** How a run ended: ordered (the success), gave up, or left without ordering. */
export function OutcomeTag({ run, onSign = false }: { run: Pick<RunSummary, "order" | "gave_up" | "turns">; onSign?: boolean }) {
  if (run.order) {
    return (
      <span className={tag("good", "num")}>
        Ordered {rupees(run.order.total)}, {run.order.items} item{run.order.items === 1 ? "" : "s"}
      </span>
    );
  }
  if (run.gave_up && run.gave_up === run.turns) return <span className={tag("bad")}>Gave up</span>;
  return <span className={tag(onSign ? "on-sign" : "outline")}>Didn&apos;t order</span>;
}
