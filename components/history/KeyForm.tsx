"use client";

import { useActionState } from "react";
import { button, FIELD_ERROR, INPUT, LABEL } from "@/components/ui";
import { lock, unlock, type UnlockState } from "../../app/history/actions";

/** The admin key, asked for in place of a run's messages. */
export function KeyForm() {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlock, { error: null });
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1">
        <span className={LABEL}>Admin key</span>
        <input
          name="key"
          type="password"
          required
          autoComplete="current-password"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "key-error" : undefined}
          className={INPUT}
        />
      </label>
      <button type="submit" disabled={pending} className={button("primary")}>
        {pending ? "Checking…" : "Show messages"}
      </button>
      {state.error && (
        <p id="key-error" role="alert" className={`w-full ${FIELD_ERROR}`}>
          {state.error}
        </p>
      )}
    </form>
  );
}

/** Hides the private parts again. */
export function LockButton() {
  return (
    <form action={lock}>
      <button type="submit" className={button("quiet", "text-sm")}>
        Lock
      </button>
    </form>
  );
}
