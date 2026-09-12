/**
 * @owner Claude
 * A read-only balance check against devnet, for the account page. Talks to
 * Solana's JSON-RPC directly rather than pulling in @solana/web3.js just
 * for one call - gotchu never needs to sign anything, only read a balance.
 */
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const LAMPORTS_PER_SOL = 1_000_000_000;
// Must match voice-mcp's rate (voice-mcp/src/pay.ts) - both read the same
// env var, so they stay in sync as long as it's set the same place in both.
const RAILCOINS_PER_SOL = Number(process.env.RAILCOINS_PER_SOL || 50_000);

/** Railcoin balance for a public key, or null if the RPC call failed. */
export async function getRailcoinBalance(publicKey: string): Promise<number | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [publicKey] }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { value?: number } };
    const lamports = body.result?.value;
    if (typeof lamports !== "number") return null;
    return Math.round((lamports / LAMPORTS_PER_SOL) * RAILCOINS_PER_SOL);
  } catch {
    return null;
  }
}
