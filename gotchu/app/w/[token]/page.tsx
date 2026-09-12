/**
 * The wallet page behind a texted link.
 *
 * There is no login here on purpose: the link was sent to their number over
 * iMessage, and holding it is the proof. That trade is only acceptable because
 * the wallet holds devnet play money - anyone the link is forwarded to gets the
 * same access.
 */
import { WalletPanel } from "@/components/wallet/WalletPanel";

const MARKET = (process.env.MARKET_API_URL || "").replace(/\/$/, "");

type LinkData = {
  phone: string;
  display_name: string | null;
  wallet: { public_key: string; balance_sol: number; cluster: string } | null;
};

async function load(token: string): Promise<LinkData | null> {
  if (!MARKET) return null;
  try {
    const res = await fetch(`${MARKET}/v1/wallet-links/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data?: LinkData };
    return json.ok ? (json.data ?? null) : null;
  } catch {
    return null;
  }
}

export default async function WalletLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await load(token);

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-md px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">This link has expired</h1>
        <p className="mt-4 text-muted-foreground">
          Text your agent and ask for a new one — they expire so an old message cannot be used
          months later.
        </p>
      </main>
    );
  }

  const first = data.display_name?.split(" ")[0];

  return (
    <main className="mx-auto w-full max-w-md px-6 py-16">
      <p className="text-sm tracking-wide text-muted-foreground">
        {first ? `${first}'s wallet` : "Your wallet"}
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-[var(--ink)]">Railcoins</h1>
      <p className="mt-4 text-muted-foreground">
        What you earn from finished tasks lands here, and what you pay for a task comes out of it.
      </p>
      <div className="my-8 h-px bg-[var(--ink)]/10" />
      <WalletPanel token={token} initial={data.wallet} />
      <p className="mt-8 text-xs text-muted-foreground">
        This is devnet play money on Solana, not real currency. Anyone you forward this link to can
        see this page, so keep it to yourself.
      </p>
    </main>
  );
}
