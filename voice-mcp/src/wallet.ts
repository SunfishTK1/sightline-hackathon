import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  clusterApiUrl, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { pool, normalizePhone, upsertPerson } from "./db.js";

const CLUSTER = process.env.SOLANA_CLUSTER || "devnet";
const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl(CLUSTER as any);
const AIRDROP_SOL = Number(process.env.SOLANA_AIRDROP_SOL || 0.5);

export const connection = new Connection(RPC_URL, "confirmed");

/**
 * Every wallet's secret key is encrypted with this before it touches the
 * database. Devnet SOL is worthless, but the key format is identical to
 * mainnet - a leaked row should not just be a base58 string away from a
 * usable keypair.
 */
function encryptionKey(): Buffer {
  const secret = process.env.WALLET_ENCRYPTION_KEY;
  if (!secret) throw new Error("WALLET_ENCRYPTION_KEY is not set");
  return scryptSync(secret, "gotchu-wallet", 32);
}

function encryptSecretKey(bytes: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(".");
}

function decryptSecretKey(encrypted: string): Uint8Array {
  const [ivB64, tagB64, ciphertextB64] = encrypted.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
}

/**
 * The one wallet that hands out starter SOL. Fund it yourself on devnet
 * (`solana airdrop 5 <its pubkey> --url devnet`) - individual per-user
 * airdrops hit the public faucet's rate limit almost immediately once there
 * is more than a handful of users.
 */
let treasury: Keypair | null = null;
function treasuryKeypair(): Keypair {
  if (treasury) return treasury;
  const raw = process.env.SOLANA_TREASURY_SECRET_KEY;
  if (!raw) throw new Error("SOLANA_TREASURY_SECRET_KEY is not set");
  const secretKey = Uint8Array.from(JSON.parse(raw) as number[]);
  treasury = Keypair.fromSecretKey(secretKey);
  return treasury;
}

export type Wallet = {
  person_id: string;
  public_key: string;
  cluster: string;
  funded_at: string | null;
  created_at: string;
};

async function getWalletRow(personId: string): Promise<Wallet & { encrypted_secret_key: string } | null> {
  const { rows } = await pool.query(
    `SELECT person_id, public_key, encrypted_secret_key, cluster, funded_at, created_at
       FROM wallets WHERE person_id = $1`,
    [personId],
  );
  return rows[0] ?? null;
}

/** Transfer starter SOL from the treasury. Failure here should not stop wallet creation. */
async function fundFromTreasury(publicKey: string): Promise<boolean> {
  try {
    const from = treasuryKeypair();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: new PublicKey(publicKey),
        lamports: Math.round(AIRDROP_SOL * LAMPORTS_PER_SOL),
      }),
    );
    await sendAndConfirmTransaction(connection, tx, [from]);
    return true;
  } catch (err) {
    console.error(`treasury transfer to ${publicKey} failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Create this person's devnet wallet the first time anyone asks for it, and
 * fund it with the starter amount. Safe to call every time someone is
 * identified - it is a no-op once the wallet exists.
 */
export async function ensureWallet(phone: string): Promise<Wallet> {
  const e164 = normalizePhone(phone);
  const person = await upsertPerson(e164);

  const existing = await getWalletRow(person.id);
  if (existing) {
    const { encrypted_secret_key: _drop, ...wallet } = existing;
    return wallet;
  }

  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toBase58();
  const encrypted = encryptSecretKey(keypair.secretKey);

  const { rows } = await pool.query(
    `INSERT INTO wallets (person_id, public_key, encrypted_secret_key, cluster)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (person_id) DO NOTHING
     RETURNING person_id, public_key, cluster, funded_at, created_at`,
    [person.id, publicKey, encrypted, CLUSTER],
  );
  // Somebody else's concurrent request won the insert; use theirs.
  const wallet = rows[0] ?? (await getWalletRow(person.id))!;

  if (!wallet.funded_at) {
    const funded = await fundFromTreasury(wallet.public_key);
    if (funded) {
      const { rows: updated } = await pool.query(
        `UPDATE wallets SET funded_at = now() WHERE person_id = $1
         RETURNING person_id, public_key, cluster, funded_at, created_at`,
        [person.id],
      );
      return updated[0];
    }
  }
  return wallet;
}

export async function getWallet(phone: string): Promise<(Wallet & { balance_sol: number }) | null> {
  const person = await upsertPerson(normalizePhone(phone));
  const wallet = await getWalletRow(person.id);
  if (!wallet) return null;
  const { encrypted_secret_key: _drop, ...rest } = wallet;
  const lamports = await connection.getBalance(new PublicKey(wallet.public_key));
  return { ...rest, balance_sol: lamports / LAMPORTS_PER_SOL };
}

/** For anything that needs to sign on the person's behalf, not exposed over the API. */
export async function loadWalletKeypair(personId: string): Promise<Keypair | null> {
  const row = await getWalletRow(personId);
  if (!row) return null;
  return Keypair.fromSecretKey(decryptSecretKey(row.encrypted_secret_key));
}
