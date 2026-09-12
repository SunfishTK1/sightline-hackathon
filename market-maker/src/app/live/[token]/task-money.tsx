/**
 * What this task is worth and what the person who asked for it has left.
 *
 * The board is otherwise anonymous on purpose - candidates are colours, not
 * names - so this shows only the pot and the requester's own balance. No
 * candidate's wallet appears here, and it stays that way: the link is
 * forwardable, and a worker's balance is nobody else's business.
 */
export function TaskMoney({
  railcoins,
  requesterBalance,
}: {
  railcoins: number | null;
  requesterBalance: number | null;
}) {
  if (railcoins == null && requesterBalance == null) return null;

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium tracking-wide text-zinc-500 uppercase">The money</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {railcoins != null && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <p className="text-sm text-zinc-500">This task pays</p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-[#1f5c3a]">
              {railcoins.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              railcoins · moves when the requester confirms
            </p>
          </div>
        )}
        {requesterBalance != null && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <p className="text-sm text-zinc-500">Requester&apos;s balance</p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-zinc-900">
              {requesterBalance.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {railcoins != null && requesterBalance < railcoins
                ? "not enough to cover this task"
                : "enough to cover this task"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
