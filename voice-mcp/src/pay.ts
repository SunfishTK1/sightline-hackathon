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
import { connection, loadWalletKeypair, ensureWallet, treasuryKeypair } from "./wallet.js";
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
 * Only one caller may initiate a transfer per order. Claim the payment row
 * before talking to the chain, otherwise two retries both send SOL.
 */
const UNRECORDED_PREFIX = "unrecorded:";

function signatureFromNote(note: string | null | undefined): string | null {
  if (!note || !note.startsWith(UNRECORDED_PREFIX)) return null;
  const signature = note.slice(UNRECORDED_PREFIX.length).trim();
  return signature || null;
}

async function claimPayment(
  orderId: string,
): Promise<{ kind: "claimed" } | { kind: "already"; signature: string } | { kind: "busy"; reason: string }> {
  const claimed = await pool.query<{ id: string; note: string | null }>(
    `UPDATE payments
        SET status = 'paying', updated_at = now()
      WHERE order_id = $1
        AND solana_signature IS NULL
        AND status IS DISTINCT FROM 'paid'
        AND (
          status IS DISTINCT FROM 'paying'
          OR updated_at < now() - interval '5 minutes'
        )
      RETURNING id, note`,
    [orderId],
  );
  if (claimed.rows[0]) return { kind: "claimed" };

  const existing = await pool.query<{
    solana_signature: string | null;
    status: string | null;
    note: string | null;
  }>(
    `SELECT solana_signature, status, note FROM payments WHERE order_id = $1`,
    [orderId],
  );
  const row = existing.rows[0];
  if (row?.solana_signature) {
    return { kind: "already", signature: row.solana_signature };
  }
  const parked = signatureFromNote(row?.note);
  if (parked) {
    return { kind: "already", signature: parked };
  }
  if (row?.status === "paid") {
    return { kind: "already", signature: row.solana_signature || "paid" };
  }
  if (row?.status === "paying") {
    return { kind: "busy", reason: "settlement already in progress" };
  }
  return { kind: "busy", reason: "no payment row to settle" };
}

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

  const claim = await claimPayment(input.orderId);
  if (claim.kind === "already") {
    const recorded: Settlement = { settled: true, signature: claim.signature, railcoins };
    await persistSettlement(input.orderId, recorded).catch(() => undefined);
    const stored = await pool.query<{ solana_signature: string | null }>(
      `SELECT solana_signature FROM payments WHERE order_id = $1`,
      [input.orderId],
    );
    if (stored.rows[0]?.solana_signature) {
      return { settled: true, signature: stored.rows[0].solana_signature, railcoins };
    }
    return {
      settled: false,
      reason: `paid on-chain but not recorded: ${claim.signature}`,
      railcoins,
    };
  }
  if (claim.kind === "busy") {
    return { settled: false, reason: claim.reason, railcoins };
  }

  const parked = await pool.query<{ note: string | null }>(
    `SELECT note FROM payments WHERE order_id = $1`,
    [input.orderId],
  );
  const parkedSignature = signatureFromNote(parked.rows[0]?.note);
  if (parkedSignature) {
    const recorded: Settlement = { settled: true, signature: parkedSignature, railcoins };
    try {
      await persistSettlement(input.orderId, recorded);
      return recorded;
    } catch (err) {
      return {
        settled: false,
        reason: `paid on-chain but not recorded: ${parkedSignature} (${(err as Error).message})`,
        railcoins,
      };
    }
  }

  try {
    const [payer, payee] = await Promise.all([
      ensureWallet(input.payerPhone),
      ensureWallet(input.payeePhone),
    ]);
    const from = await loadWalletKeypair(payer.person_id);
    if (!from) {
      const result: Settlement = { settled: false, reason: "the payer has no usable wallet", railcoins };
      await recordSettlement(input.orderId, result);
      return result;
    }

    const lamports = railcoinsToLamports(railcoins);
    const balance = await connection.getBalance(from.publicKey);
    // Leave room for the fee, and say so plainly rather than letting the
    // network reject it with something unreadable.
    if (balance < lamports + 5_000) {
      const result: Settlement = {
        settled: false,
        reason: `not enough railcoins: ${railcoins} needed, ${Math.floor((balance / LAMPORTS_PER_SOL) * RAILCOINS_PER_SOL)} available`,
        railcoins,
      };
      await recordSettlement(input.orderId, result);
      return result;
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: new PublicKey(payee.public_key),
        lamports,
      }),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [from]);
    const result: Settlement = { settled: true, signature, railcoins };
    try {
      await persistSettlement(input.orderId, result);
      return result;
    } catch (err) {
      await pool
        .query(`UPDATE payments SET note = $2, updated_at = now() WHERE order_id = $1`, [
          input.orderId,
          `${UNRECORDED_PREFIX}${signature}`,
        ])
        .catch(() => undefined);
      return {
        settled: false,
        reason: `paid on-chain but not recorded: ${signature} (${(err as Error).message})`,
        railcoins,
      };
    }
  } catch (err) {
    const result: Settlement = { settled: false, reason: (err as Error).message, railcoins };
    await recordSettlement(input.orderId, result).catch(() => undefined);
    return result;
  }
}

/**
 * Charge someone a fee that goes to the house, not to another person. Same
 * rails as a task payment - a real transfer with a signature - because a fee
 * that is only bookkeeping is a fee nobody can audit.
 */
export async function chargeToTreasury(
  phone: string,
  railcoins: number,
): Promise<Settlement> {
  if (!(railcoins > 0)) return { settled: false, reason: "nothing to charge", railcoins: 0 };
  try {
    const payer = await ensureWallet(phone);
    const from = await loadWalletKeypair(payer.person_id);
    if (!from) return { settled: false, reason: "no usable wallet", railcoins };

    const lamports = railcoinsToLamports(railcoins);
    const balance = await connection.getBalance(from.publicKey);
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
        toPubkey: treasuryKeypair().publicKey,
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

/** A successful on-chain transfer must land in the DB; retry the write. */
async function persistSettlement(orderId: string, result: Settlement): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      await recordSettlement(orderId, result);
      return;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("could not record settlement");
}
