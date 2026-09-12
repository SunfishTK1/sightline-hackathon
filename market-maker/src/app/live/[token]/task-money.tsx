"use client";

/**
 * What this task is worth, what the requester has left, and the one button
 * that ends the job.
 *
 * The board is otherwise anonymous on purpose - candidates are colours, not
 * names - so this shows only the pot and the requester's own balance. No
 * candidate's wallet appears here, and it stays that way: the link is
 * forwardable, and a worker's balance is nobody else's business.
 *
 * The balance re-reads itself after paying, because a number that stays the
 * same after you spend from it reads as a payment that did not happen.
 */
import { useState } from "react";

export function TaskMoney({
  token,
  railcoins,
  requesterBalance,
  publicKey,
  cluster,
  canPay,
  alreadyPaid,
}: {
  token: string;
  railcoins: number | null;
  requesterBalance: number | null;
  publicKey?: string | null;
  cluster?: string | null;
  canPay: boolean;
  /** Settled before this page was opened, so say so instead of going quiet. */
  alreadyPaid: boolean;
}) {
  const [balance, setBalance] = useState(requesterBalance);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(alreadyPaid);
  const [error, setError] = useState<string | null>(null);

  const short = railcoins != null && balance != null && balance < railcoins;

  async function payNow() {
    setPaying(true);
    setError(null);
    try {
      const res = await fetch(`/api/live/${token}/received`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(
          json.error === "already_paid"
            ? "This one is already paid."
            : json.error === "nobody_has_taken_it"
              ? "Nobody has taken this yet, so there is nobody to pay."
              : "That did not go through. Try again.",
        );
        return;
      }
      setPaid(true);
      if (typeof json.railcoins === "number" && balance != null) {
        setBalance(balance - json.railcoins);
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">The money</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {railcoins != null && (
          <div className="min-w-0 overflow-hidden rounded-[20px] border border-[#e7e2d8] bg-white p-4 sm:rounded-[28px] sm:p-5">
            <p className="text-sm text-zinc-500">This task pays</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[#1f5c3a] sm:text-3xl">
              {railcoins.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {paid ? "railcoins · paid" : "railcoins · moves when you confirm"}
            </p>
          </div>
        )}
        <div className="min-w-0 overflow-hidden rounded-[20px] border border-[#e7e2d8] bg-white p-4 sm:rounded-[28px] sm:p-5">
          <p className="text-sm text-zinc-500">Your Solana wallet</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-900 sm:text-3xl">
            {balance != null ? balance.toLocaleString() : "—"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {balance == null
              ? "railcoins · wallet attaches when this job is live"
              : short
                ? "not enough to cover this task"
                : "enough to cover this task"}
          </p>
          {publicKey ? (
            <p className="mt-3 break-all font-mono text-[11px] leading-4 text-zinc-500">
              {publicKey}
              {cluster ? ` · ${cluster}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {paid ? (
        <p className="mt-4 rounded-2xl border border-[#1f5c3a]/30 bg-[#1f5c3a]/5 p-4 text-sm text-[#1f5c3a]">
          Paid. {railcoins} railcoins went to whoever did it — you&apos;re square, nothing to hand
          over or Venmo.
        </p>
      ) : canPay ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={payNow}
            disabled={paying}
            className="w-full rounded-xl bg-[#1f5c3a] px-5 py-3 text-base font-medium text-white disabled:opacity-60 sm:w-auto sm:px-8"
          >
            {paying ? "Paying…" : `Got it — pay ${railcoins ?? ""} railcoins`}
          </button>
          <p className="mt-2 text-sm text-zinc-500">
            One tap marks it received and pays them. There is no undo.
          </p>
        </div>
      ) : null}

      {error && <p className="mt-3 text-sm text-[#b3321e]">{error}</p>}
    </section>
  );
}
