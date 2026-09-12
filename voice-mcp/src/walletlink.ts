/**
 * A link the agent can text someone so they can open their own wallet.
 *
 * The proof of identity is the delivery: the link went to their number over
 * iMessage, and only the person holding that phone received it. That is a
 * deliberate trade - anyone the link is forwarded to gets the same access -
 * and it is acceptable here because the wallet holds devnet play money. It
 * would not be acceptable for anything real.
 *
 * The link stays usable until it expires, because it is somewhere to check a
 * balance, not a one-time confirmation.
 */
import { randomBytes } from "node:crypto";
import { pool, normalizePhone, upsertPerson } from "./db.js";
import { ensureWallet, getWallet } from "./wallet.js";

const LINK_TTL_DAYS = Number(process.env.WALLET_LINK_TTL_DAYS || 14);
const WEB_BASE_URL = (process.env.WEB_BASE_URL || "").replace(/\/$/, "");

export async function createWalletLink(phone: string) {
  const e164 = normalizePhone(phone);
  const person = await upsertPerson(e164);
  const token = randomBytes(24).toString("base64url");

  await pool.query(
    `INSERT INTO wallet_links (token, person_id, phone, expires_at)
     VALUES ($1,$2,$3, now() + ($4 || ' days')::interval)`,
    [token, person.id, e164, String(LINK_TTL_DAYS)],
  );

  return {
    token,
    url: WEB_BASE_URL ? `${WEB_BASE_URL}/w/${token}` : null,
    expires_in_days: LINK_TTL_DAYS,
  };
}

/** Who the link belongs to, and what their wallet looks like right now. */
export async function resolveWalletLink(token: string) {
  const { rows } = await pool.query(
    `UPDATE wallet_links SET opened_at = COALESCE(opened_at, now())
      WHERE token = $1 AND expires_at > now()
      RETURNING person_id, phone`,
    [token],
  );
  const link = rows[0];
  if (!link) return null;

  const person = await pool.query(
    `SELECT display_name FROM people WHERE id = $1`,
    [link.person_id],
  );

  return {
    phone: link.phone,
    display_name: person.rows[0]?.display_name ?? null,
    wallet: await getWallet(link.phone),
  };
}

/** Make the wallet for whoever holds this link. Idempotent. */
export async function createWalletForLink(token: string) {
  const { rows } = await pool.query(
    `SELECT phone FROM wallet_links WHERE token = $1 AND expires_at > now()`,
    [token],
  );
  const link = rows[0];
  if (!link) return null;
  await ensureWallet(link.phone);
  return getWallet(link.phone);
}
