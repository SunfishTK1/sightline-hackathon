/** @owner Will — availability switch in header */
"use client";

import { useState } from "react";

type Props = {
  /** Null when the viewer has no worker profile yet - then there is nothing to toggle. */
  initial: boolean | null;
};

export function AvailabilityToggle({ initial }: Props) {
  const [available, setAvailable] = useState(Boolean(initial));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (initial === null) return null;

  async function change(next: boolean) {
    // Move immediately, then put it back if the server disagrees - the toggle
    // should never claim a state the marketplace is not actually in.
    setAvailable(next);
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/me/availability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAvailable: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "failed");
      setAvailable(Boolean(json.data?.is_available));
    } catch {
      setAvailable(!next);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label
      className="flex items-center gap-2 text-sm text-muted-foreground"
      title={
        failed
          ? "That did not save."
          : available
            ? "You can be offered work."
            : "You will not be offered work."
      }
    >
      <input
        type="checkbox"
        className="size-4 accent-[var(--broker)]"
        checked={available}
        disabled={busy}
        onChange={(e) => change(e.target.checked)}
      />
      {failed ? <span className="text-[var(--stop)]">Not saved</span> : "Available"}
    </label>
  );
}
