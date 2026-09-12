/**
 * Turn a finished signup into a participant the rest of the system can see.
 *
 * Onboarding writes the person into `people`, which the texting and matching
 * backend already reads. Two things still have to happen before signing up
 * actually does anything:
 *
 *   1. A worker profile, or the matcher has nobody to consider - a person in
 *      `people` with no row in `worker_profiles` is invisible to it.
 *   2. An introduction, so the agent opens the conversation rather than the
 *      person's first text arriving cold.
 *   3. A funded wallet, so their starting railcoins are actually there. The
 *      wallet used to be created lazily at the first payment, which meant a
 *      brand-new account's balance read as nothing at all until they had
 *      already transacted - the one moment the number matters most.
 *
 * The profile starts unavailable on purpose. Nothing here has proved the phone
 * number is theirs, and a mistyped number would otherwise receive job offers
 * meant for someone else. The agent asks them to confirm, and flips the profile
 * with set_availability when they say yes.
 *
 * Failure here must never fail the signup: the account is already saved, and
 * the person can be brought into the pool later.
 */
import { getPool, postgresConfigured } from "./pg";

const MARKET = (process.env.MARKET_API_URL || "").replace(/\/$/, "");
const MARKET_TOKEN = process.env.MCP_AUTH_TOKEN || process.env.VOICE_MCP_AUTH_TOKEN || "";

/**
 * Ask the marketplace service to create and fund this person's wallet.
 *
 * It has to be done over HTTP rather than here: the encryption key and the
 * treasury's signing key live in that service and nowhere else, which is the
 * point - the web app can ask for a wallet but can never mint or spend one.
 *
 * Best-effort by design. The grant is also made on demand at the first
 * payment, so a failure here costs the person a number on a page, not money.
 */
async function ensureFundedWallet(phone: string): Promise<void> {
  if (!MARKET) return;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MARKET_TOKEN) {
    headers.Authorization = `Bearer ${MARKET_TOKEN}`;
    headers["x-api-key"] = MARKET_TOKEN;
  }
  try {
    const res = await fetch(`${MARKET}/v1/wallets/ensure`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone }),
      cache: "no-store",
      // Funding is a devnet transaction the signup should never wait on for
      // long; the retry path is the next payment.
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error(`wallet for ${phone} was not created: ${res.status}`);
    }
  } catch (err) {
    console.error(`wallet for ${phone} was not created:`, err);
  }
}

export type Activation = {
  personId: string;
  phone: string;
  displayName: string | null;
  /** What they said they are up for, in their words. */
  blurb?: string | null;
};

export async function activateParticipant(person: Activation): Promise<void> {
  if (!postgresConfigured()) return;
  const pool = getPool();

  try {
    // Unavailable until the number is confirmed over text.
    await pool.query(
      `INSERT INTO worker_profiles (person_id, phone, is_available, blurb, categories, updated_at)
       VALUES ($1, $2, false, $3, '{}'::text[], now())
       ON CONFLICT (person_id) DO UPDATE
         SET phone = EXCLUDED.phone,
             blurb = COALESCE(EXCLUDED.blurb, worker_profiles.blurb),
             updated_at = now()`,
      [person.personId, person.phone, person.blurb ?? null],
    );

    // One introduction per person, not one per time they edit their profile.
    await pool.query(
      `INSERT INTO agent_handoffs (person_id, phone, kind, payload)
       SELECT $1, $2, 'welcome', $3::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM agent_handoffs
           WHERE person_id = $1 AND kind = 'welcome')`,
      [
        person.personId,
        person.phone,
        JSON.stringify({
          source: "web_signup",
          display_name: person.displayName,
          note: "They just signed up on the site. Ask them to confirm this is their number and that they want to be asked to do tasks; use set_availability when they agree.",
        }),
      ],
    );
  } catch (err) {
    // Worth seeing in the logs, never worth losing the signup over.
    console.error("could not bring the new signup into the marketplace:", err);
  }

  // Outside the try: a failed profile write should not cost them the wallet,
  // and a failed wallet should not cost them the profile.
  await ensureFundedWallet(person.phone);
}

/** Keep marketplace lookups in sync after a later profile edit. */
export async function syncWorkerProfile(person: {
  personId: string;
  phone?: string;
  blurb?: string | null;
}): Promise<void> {
  if (!postgresConfigured()) return;
  try {
    await getPool().query(
      `UPDATE worker_profiles
          SET phone = COALESCE($2, phone),
              blurb = COALESCE($3, blurb),
              updated_at = now()
        WHERE person_id = $1`,
      [person.personId, person.phone ?? null, person.blurb ?? null],
    );
  } catch (err) {
    console.error("could not sync worker profile:", err);
  }
}

/**
 * Flip the matching-pool flag the matcher actually reads. Voice-mcp only
 * treats someone as available after the phone is verified; we honor that
 * so the web toggle cannot put unverified numbers into the pool.
 */
export async function syncWorkerAvailability(
  personId: string,
  isAvailable: boolean,
): Promise<{ isAvailable: boolean; reason?: "no_profile" | "phone_unverified" | "sync_failed" }> {
  if (!postgresConfigured()) return { isAvailable };
  try {
    const { rows } = await getPool().query<{ is_available: boolean; phone_verified: boolean | null }>(
      `UPDATE worker_profiles w
          SET is_available = ($2 AND COALESCE(p.phone_verified, false)),
              updated_at = now()
         FROM people p
        WHERE p.id = w.person_id AND w.person_id = $1
        RETURNING w.is_available, p.phone_verified`,
      [personId, isAvailable],
    );
    if (!rows[0]) return { isAvailable: false, reason: "no_profile" };
    const actual = Boolean(rows[0].is_available);
    if (isAvailable && !actual) return { isAvailable: false, reason: "phone_unverified" };
    return { isAvailable: actual };
  } catch (err) {
    console.error("could not sync worker availability:", err);
    return { isAvailable: false, reason: "sync_failed" };
  }
}

/** Matching-pool flag, or null if they have no worker profile yet. */
export async function getWorkerAvailability(personId: string): Promise<boolean | null> {
  if (!postgresConfigured()) return null;
  try {
    const { rows } = await getPool().query<{ is_available: boolean }>(
      `SELECT is_available FROM worker_profiles WHERE person_id = $1`,
      [personId],
    );
    return rows[0] ? Boolean(rows[0].is_available) : null;
  } catch (err) {
    console.error("could not read worker availability:", err);
    return null;
  }
}

/** A new number is unproven — take them out of the matching pool. */
export async function dropWorkerAvailability(personId: string): Promise<void> {
  if (!postgresConfigured()) return;
  try {
    await getPool().query(
      `UPDATE worker_profiles SET is_available = false, updated_at = now() WHERE person_id = $1`,
      [personId],
    );
  } catch (err) {
    console.error("could not drop worker availability:", err);
  }
}
