/**
 * Paying for a finished task, in railcoins.
 *
 * Everyone has a devnet wallet (see wallet.ts, which owns the keys and the
 * railcoin/SOL rate). This moves value between two of them when a requester
 * confirms the work is done - the one moment where money should change hands,
 * because it is the only point at which both sides have agreed.
 *
 * Devnet SOL is play money, but the transfer is a real on-chain one, so it can
 * fail for real reasons: not enough balance, or a transfer that would leave an
 * account below the rent-exempt minimum. A failure is recorded rather than
 * swallowed - the task is still complete, the payment simply did not settle.
 */
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { connection, loadWalletKeypair, ensureWallet } from "./wallet.js";
import { pool } from "./db.js";

/** Users see railcoins; 50,000 railcoins is 1 SOL. One railcoin is one dollar of task value. */
export const RAILCOINS_PER_SOL = Number(process.env.RAILCOINS_PER_SOL || 50_000);

export function railcoinsToLamports(railcoins: number): number {
  return Math.round((railcoins / RAILCOINS_PER_SOL) * LAMPORTS_PER_SOL);
}

export type Settlement =
  | { settled: true; signature: string; railcoins: number }
  | { settled: false; reason: string; railcoins: number };

/**
 * Move the task's price from the requester to the worker.
 *
 * Both wallets are created on demand: someone who has only ever been texted a
 * job may never have had one made.
 */
export async function payForTask(input: {
  orderId: string;
  payerPhone: string;
  payeePhone: string;
  amountUsd: number;
}): Promise<Settlement> {
  const railcoins = Math.round(input.amountUsd);
  if (!(railcoins > 0)) {
    return { settled: false, reason: "nothing to pay - the task had no price", railcoins: 0 };
  }

  const already = await pool.query<{ solana_signature: string }>(
    `SELECT solana_signature FROM payments
      WHERE order_id = $1 AND solana_signature IS NOT NULL`,
    [input.orderId],
  );
  if (already.rows[0]?.solana_signature) {
    return { settled: true, signature: already.rows[0].solana_signature, railcoins };
  }

  try {
    const [payer, payee] = await Promise.all([
      ensureWallet(input.payerPhone),
      ensureWallet(input.payeePhone),
    ]);
    const from = await loadWalletKeypair(payer.person_id);
    if (!from) return { settled: false, reason: "the payer has no usable wallet", railcoins };

    const lamports = railcoinsToLamports(railcoins);
    const balance = await connection.getBalance(from.publicKey);
    // Leave room for the fee, and say so plainly rather than letting the
    // network reject it with something unreadable.
    if (balance < lamports + 5_000) {
      return {
        settled: false,
        reason: `not enough railcoins: ${railcoins} needed, ${Math.floor((balance / LAMPORTS_PER_SOL) * RAILCOINS_PER_SOL)} available`,
        railcoins,
      };
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: new PublicKey(payee.public_key),
        lamports,
      }),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [from]);
    return { settled: true, signature, railcoins };
  } catch (err) {
    return { settled: false, reason: (err as Error).message, railcoins };
  }
}

/** Record how the settlement went against the payment row for the task. */
export async function recordSettlement(orderId: string, result: Settlement): Promise<void> {
  await pool.query(
    `UPDATE payments
        SET status = $2, solana_signature = $3, railcoins = $4,
            note = $5, updated_at = now()
      WHERE order_id = $1`,
    [
      orderId,
      result.settled ? "paid" : "settlement_failed",
      result.settled ? result.signature : null,
      result.railcoins,
      result.settled ? null : result.reason,
    ],
  );
}
