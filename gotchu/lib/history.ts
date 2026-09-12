/**
 * @owner Claude
 * Account history for a returning, already-onboarded person: what they've
 * asked for, what they've done for others, and their railcoin balance.
 * Reads straight from the shared Postgres - the same `people`/`orders`/
 * `wallets` tables the texting backend (voice-mcp) writes to - rather than
 * calling voice-mcp over HTTP, since gotchu already has a pool open to the
 * same database.
 */
import type { QueryResultRow } from "pg";
import { getPool, postgresConfigured } from "./pg";
import { getRailcoinBalance } from "./wallet-balance";

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export type TaskHistoryItem = {
  id: string;
  title: string;
  status: string;
  category: string | null;
  budgetUsd: string | null;
  createdAt: string;
  completedAt: string | null;
  /** The other side of this task - who did it (for a request) or who asked (for work). */
  counterpartName: string | null;
};

function toHistoryItem(row: QueryResultRow, counterpartKey: string): TaskHistoryItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    category: row.category,
    budgetUsd: row.budget_usd,
    createdAt: iso(row.created_at)!,
    completedAt: iso(row.completed_at),
    counterpartName: row[counterpartKey] ?? null,
  };
}

/** Tasks this person has asked for, newest first. */
export async function getRequestHistory(personId: string): Promise<TaskHistoryItem[]> {
  if (!postgresConfigured()) return [];
  const { rows } = await getPool().query(
    `SELECT o.id, o.title, o.status, o.category, o.budget_usd, o.created_at, o.completed_at,
            w.display_name AS worker_name
       FROM orders o
       LEFT JOIN people w ON w.id = o.accepted_by
      WHERE o.person_id = $1
      ORDER BY o.created_at DESC
      LIMIT 50`,
    [personId],
  );
  return rows.map((r) => toHistoryItem(r, "worker_name"));
}

/** Tasks this person has done (or is doing) for someone else, newest first. */
export async function getWorkHistory(personId: string): Promise<TaskHistoryItem[]> {
  if (!postgresConfigured()) return [];
  const { rows } = await getPool().query(
    `SELECT o.id, o.title, o.status, o.category, o.budget_usd, o.created_at, o.completed_at,
            p.display_name AS requester_name
       FROM orders o
       JOIN people p ON p.id = o.person_id
      WHERE o.accepted_by = $1
      ORDER BY o.created_at DESC
      LIMIT 50`,
    [personId],
  );
  return rows.map((r) => toHistoryItem(r, "requester_name"));
}

export type WalletSummary = {
  publicKey: string;
  cluster: string;
  fundedAt: string | null;
  /** null only means the live balance check failed, not that the balance is zero. */
  balanceRailcoins: number | null;
};

/** This person's devnet wallet, with a live balance check - null if they have none yet. */
export async function getWalletSummary(personId: string): Promise<WalletSummary | null> {
  if (!postgresConfigured()) return null;
  const { rows } = await getPool().query(
    `SELECT public_key, cluster, funded_at FROM wallets WHERE person_id = $1`,
    [personId],
  );
  const row = rows[0];
  if (!row) return null;
  // A row can exist before funded_at is set (airdrop pending). Still ask
  // the chain — 0 is only correct after a successful empty-balance read.
  const balanceRailcoins = await getRailcoinBalance(row.public_key);
  return {
    publicKey: row.public_key,
    cluster: row.cluster,
    fundedAt: iso(row.funded_at),
    balanceRailcoins,
  };
}
