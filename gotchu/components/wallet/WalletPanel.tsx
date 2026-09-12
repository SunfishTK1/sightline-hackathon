"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** 50,000 railcoins to 1 SOL, matching the rate the backend settles at. */
const RAILCOINS_PER_SOL = 50_000;

type Wallet = { public_key: string; balance_sol: number; cluster: string } | null;

export function WalletPanel({ token, initial }: { token: string; initial: Wallet }) {
  const [wallet, setWallet] = useState<Wallet>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wallet-links/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error === "link_expired" ? "This link has expired." : "Could not make your wallet. Try again.");
        return;
      }
      setWallet(json.data);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <div className="space-y-5">
        <p className="text-[var(--ink)]">
          You don&apos;t have a wallet yet. Making one takes a second and starts you off with some
          railcoins to spend.
        </p>
        {error && <p className="text-sm text-[var(--stop)]">{error}</p>}
        <Button onClick={create} disabled={busy}>
          {busy ? "Making it…" : "Create my wallet"}
        </Button>
      </div>
    );
  }

  const railcoins = Math.round(wallet.balance_sol * RAILCOINS_PER_SOL);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Balance</p>
        <p className="font-mono text-5xl font-semibold tabular-nums text-[var(--broker)]">
          {railcoins.toLocaleString()}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">railcoins</p>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">Address ({wallet.cluster})</p>
        <p className="mt-1 break-all font-mono text-xs text-[var(--ink)]">{wallet.public_key}</p>
      </div>
    </div>
  );
}
