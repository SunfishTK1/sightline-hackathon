"use client";

/**
 * Ask for a film of this task, and pay for it.
 *
 * Films used to be made for every task automatically - minutes of rendering
 * per job, whether anyone wanted one or not. Now the requester decides, and
 * the cost is theirs: the price is stated before the click, and the charge
 * happens before anything renders.
 */
import { useState } from "react";

export function FilmButton({
  token,
  fee,
  alreadyRequested,
}: {
  token: string;
  fee: number;
  alreadyRequested: boolean;
}) {
  const [requested, setRequested] = useState(alreadyRequested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function askForFilm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/live/${token}/film`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(
          res.status === 409
            ? "You've already asked for one."
            : res.status === 402
              ? `Not enough railcoins — a film costs ${fee}.`
              : "That didn't go through. Try again.",
        );
        return;
      }
      setRequested(true);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (requested) {
    return (
      <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-5">
        <p className="text-sm font-medium text-zinc-900">Film on its way</p>
        <p className="mt-1 text-sm text-zinc-600">
          It takes about four minutes. When it&apos;s ready it goes to you and to everyone
          currently taking work.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-5">
      <p className="text-sm font-medium text-zinc-900">Make a film of this task</p>
      <p className="mt-1 text-sm text-zinc-600">
        Sixteen seconds, played completely straight, sent to you and to every tasker who is
        active right now. Costs {fee} railcoins, charged when you tap.
      </p>
      {error && <p className="mt-3 text-sm text-[#b3321e]">{error}</p>}
      <button
        type="button"
        onClick={askForFilm}
        disabled={busy}
        className="mt-4 w-full rounded-xl bg-[#1f5c3a] px-5 py-3 text-base font-medium text-white disabled:opacity-60 sm:w-auto sm:px-8"
      >
        {busy ? "Charging…" : `Make the film — ${fee} railcoins`}
      </button>
    </section>
  );
}
