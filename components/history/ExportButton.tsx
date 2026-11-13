"use client";

import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { button, FIELD_ERROR, INPUT, LABEL } from "@/components/ui";

/**
 * Export logs: asks for the admin key (unless this browser already gave it), then downloads a zip of
 * every run in the last 90 days with its messages, trace steps, orders and votes.
 */
export function ExportButton({ unlocked }: { unlocked: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "working" } | { kind: "error"; text: string }>({ kind: "idle" });

  async function download(withKey: string | null) {
    setState({ kind: "working" });
    try {
      const res = await fetch("/api/history/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withKey == null ? {} : { key: withKey }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        // A cookie that has expired: ask for the key instead.
        if (withKey == null && res.status === 401) {
          setState({ kind: "idle" });
          return setOpen(true);
        }
        return setState({ kind: "error", text: body?.error ?? "Couldn't make the export right now." });
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "jhola-logs.zip";
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState({ kind: "idle" });
      setOpen(false);
      setKey("");
    } catch {
      setState({ kind: "error", text: "Couldn't reach the site. Check your connection and try again." });
    }
  }

  return (
    <>
      <button type="button" onClick={() => (unlocked ? void download(null) : setOpen(true))} disabled={state.kind === "working" && !open} className={button("secondary", "text-sm")}>
        {state.kind === "working" && !open ? "Preparing…" : "Export logs"}
      </button>
      {state.kind === "error" && !open && (
        <p role="alert" className={`w-full ${FIELD_ERROR}`}>
          {state.text}
        </p>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Export logs">
        <p className="text-ink-soft">
          A zip of every run in the last 90 days: runs, turns with their messages, trace steps, orders with ratings, and votes, as CSV files with a README. It holds what shoppers wrote, so it needs
          the admin key.
        </p>
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void download(key);
          }}
        >
          <label className="block">
            <span className={LABEL}>Admin key</span>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              autoComplete="current-password"
              aria-invalid={state.kind === "error" ? true : undefined}
              aria-describedby={state.kind === "error" ? "export-error" : undefined}
              className={INPUT}
            />
          </label>
          {state.kind === "error" && (
            <p id="export-error" role="alert" className={FIELD_ERROR}>
              {state.text}
            </p>
          )}
          <button type="submit" disabled={!key || state.kind === "working"} className={button("primary", "w-full py-3")}>
            {state.kind === "working" ? "Preparing…" : "Download zip"}
          </button>
        </form>
      </Sheet>
    </>
  );
}
