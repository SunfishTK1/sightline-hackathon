/**
 * Web signup. Someone who signs up on the site becomes the same kind of
 * participant as someone who called in: one `people` row keyed on their phone,
 * plus a worker profile if they are willing to take work.
 *
 * The phone is the identity here - it is what the agent texts - so a number
 * is not live until a code sent to it comes back. Until then the person exists
 * but is not in the pool, and nothing automated ever reaches them.
 */
import { pool, normalizePhone } from "./db.js";

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const AGENT_BASE_URL = (process.env.AGENT_BASE_URL || "").replace(/\/$/, "");

export type SignupInput = {
  auth0_sub: string;
  email: string;
  display_name?: string;
  phone: string;
  blurb?: string;
  categories?: string[];
  min_price_usd?: number;
  wants_work?: boolean;
};

function sixDigits(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Ask the agent to text the code. It holds the iMessage credentials. */
async function textCode(phone: string, code: string): Promise<boolean> {
  if (!AGENT_BASE_URL) return false;
  try {
    const res = await fetch(`${AGENT_BASE_URL}/v1/say`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phones: [phone],
        text: `Your Gotchu code is ${code}. Enter it on the signup page to finish. It expires in ${CODE_TTL_MINUTES} minutes. If you didn't start a signup, ignore this.`,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Create or update the account, then send a code. Safe to call again: a second
 * submission replaces the live code rather than stacking another one.
 */
export async function registerSignup(input: SignupInput) {
  const e164 = normalizePhone(input.phone);
  const client = await pool.connect();
  let saved: any;
  try {
    await client.query("BEGIN");
    // Any phone identity not already bound to this account is a conflict. A
    // voice-only row can contain private tasks and a wallet, so merely typing
    // that number on the web must not claim it.
    const clash = await client.query(
      `SELECT auth0_sub FROM people
        WHERE phone = $1 AND auth0_sub IS DISTINCT FROM $2`,
      [e164, input.auth0_sub],
    );
    if (clash.rowCount) {
      await client.query("ROLLBACK");
      return { error: "phone_in_use" as const };
    }

    // New web-only numbers start unverified. A pre-existing phone identity
    // keeps its proof, because that thread has already called or signed up.
    const targetResult = await client.query(
      `INSERT INTO people (phone, display_name, phone_verified)
       VALUES ($1,$2,false)
       ON CONFLICT (phone) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, people.display_name)
       RETURNING *`,
      [e164, input.display_name ?? null],
    );
    const target = targetResult.rows[0];
    const previous = await client.query(
      `SELECT id, phone, display_name, email, signed_up_at, doc
         FROM people
        WHERE auth0_sub = $1 AND id <> $2
        FOR UPDATE`,
      [input.auth0_sub, target.id],
    );
    const previousPerson = previous.rows[0];
    const previousId = previousPerson?.id as string | undefined;
    const profileSource = await client.query(
      `SELECT is_available, blurb, categories, min_price_usd,
              auto_counter, auto_accept, stripe_account_id, payouts_ready
         FROM worker_profiles
        WHERE person_id = $1`,
      [previousId ?? target.id],
    );

    if (previousId) {
      // Move every account-owned relationship before retiring the old phone
      // identity. The new number is still unverified, but history and wallet
      // keys remain attached to the same Auth0 account.
      await client.query(
        `WITH moved_calls AS (
           UPDATE calls
              SET person_id = $2,
                  caller_phone = CASE WHEN caller_phone = $3 THEN $4 ELSE caller_phone END
            WHERE person_id = $1 OR caller_phone = $3
            RETURNING id
         ),
         moved_orders AS (
           UPDATE orders
              SET person_id = CASE WHEN person_id = $1 THEN $2 ELSE person_id END,
                  accepted_by = CASE WHEN accepted_by = $1 THEN $2 ELSE accepted_by END
            WHERE person_id = $1 OR accepted_by = $1
            RETURNING id
         ),
         moved_handoffs AS (
           UPDATE agent_handoffs
              SET person_id = CASE WHEN person_id = $1 THEN $2 ELSE person_id END,
                  phone = CASE WHEN phone = $3 THEN $4 ELSE phone END
            WHERE person_id = $1 OR phone = $3
            RETURNING id
         ),
         moved_offers AS (
           UPDATE job_offers
              SET person_id = CASE WHEN person_id = $1 THEN $2 ELSE person_id END,
                  phone = CASE WHEN phone = $3 THEN $4 ELSE phone END
            WHERE person_id = $1 OR phone = $3
            RETURNING id
         ),
         moved_payments AS (
           UPDATE payments
              SET payer_id = CASE WHEN payer_id = $1 THEN $2 ELSE payer_id END,
                  payee_id = CASE WHEN payee_id = $1 THEN $2 ELSE payee_id END
            WHERE payer_id = $1 OR payee_id = $1
            RETURNING id
         ),
         moved_wallet AS (
           UPDATE wallets SET person_id = $2 WHERE person_id = $1 RETURNING person_id
         ),
         moved_style AS (
           UPDATE person_style SET person_id = $2 WHERE person_id = $1 RETURNING person_id
         ),
         moved_links AS (
           UPDATE wallet_links SET person_id = $2, phone = $4
            WHERE person_id = $1
            RETURNING token
         ),
         moved_questions AS (
           UPDATE job_questions SET asker_phone = $4 WHERE asker_phone = $3 RETURNING id
         )
         SELECT 1`,
        [previousId, target.id, previousPerson.phone, e164],
      );
      await client.query(`DELETE FROM worker_profiles WHERE person_id = $1`, [previousId]);
      await client.query(`DELETE FROM people WHERE id = $1`, [previousId]);
    }

    const savedResult = await client.query(
      `UPDATE people
          SET auth0_sub = $2,
              email = COALESCE($3, email),
              display_name = COALESCE(display_name, $5),
              signed_up_at = COALESCE(signed_up_at, $7::timestamptz, now()),
              doc = jsonb_set(
                jsonb_set(
                  COALESCE($6::jsonb, '{}'::jsonb) || COALESCE(doc, '{}'::jsonb),
                  '{emailVerified}',
                  COALESCE(doc->'emailVerified', ($6::jsonb)->'emailVerified', 'false'::jsonb)
                ),
                '{wantsWork}',
                to_jsonb($4::boolean)
              )
        WHERE id = $1
        RETURNING id, phone, display_name, email, phone_verified`,
      [
        target.id,
        input.auth0_sub,
        input.email || previousPerson?.email || null,
        input.wants_work !== false,
        previousPerson?.display_name ?? null,
        previousPerson?.doc ? JSON.stringify(previousPerson.doc) : null,
        previousPerson?.signed_up_at ?? null,
      ],
    );
    saved = savedResult.rows[0];

    // A worker profile exists from the moment they say they want work, but it
    // remains unavailable until a new number is proven.
    const oldProfile = profileSource.rows[0];
    if (input.wants_work !== false || oldProfile) {
      await client.query(
        `INSERT INTO worker_profiles
           (person_id, phone, is_available, blurb, categories, min_price_usd,
            auto_counter, auto_accept, stripe_account_id, payouts_ready, updated_at)
         VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10, now())
         ON CONFLICT (person_id) DO UPDATE
           SET phone = EXCLUDED.phone,
               is_available = worker_profiles.is_available AND EXCLUDED.is_available,
               blurb = COALESCE(EXCLUDED.blurb, worker_profiles.blurb),
               categories = EXCLUDED.categories,
               min_price_usd = COALESCE(EXCLUDED.min_price_usd, worker_profiles.min_price_usd),
               auto_counter = EXCLUDED.auto_counter,
               auto_accept = EXCLUDED.auto_accept,
               stripe_account_id = COALESCE(EXCLUDED.stripe_account_id, worker_profiles.stripe_account_id),
               payouts_ready = worker_profiles.payouts_ready OR EXCLUDED.payouts_ready,
               updated_at = now()`,
        [
          saved.id,
          e164,
          Boolean(saved.phone_verified) &&
            input.wants_work !== false &&
            Boolean(oldProfile?.is_available ?? true),
          input.blurb ?? oldProfile?.blurb ?? null,
          input.categories ?? oldProfile?.categories ?? [],
          input.min_price_usd ?? oldProfile?.min_price_usd ?? null,
          Boolean(oldProfile?.auto_counter ?? true),
          Boolean(oldProfile?.auto_accept ?? false),
          oldProfile?.stripe_account_id ?? null,
          Boolean(oldProfile?.payouts_ready ?? false),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  if (saved.phone_verified) {
    // Already a known, proven number - nothing to send.
    return { person: saved, verified: true as const, code_sent: false };
  }

  const code = sixDigits();
  await pool.query(
    `INSERT INTO phone_verifications (phone, code, attempts, sent_at, expires_at, verified_at)
     VALUES ($1,$2,0, now(), now() + ($3 || ' minutes')::interval, NULL)
     ON CONFLICT (phone) DO UPDATE
       SET code = EXCLUDED.code, attempts = 0, sent_at = now(),
           expires_at = EXCLUDED.expires_at, verified_at = NULL`,
    [e164, code, String(CODE_TTL_MINUTES)],
  );
  const code_sent = await textCode(e164, code);
  return { person: saved, verified: false as const, code_sent };
}

/**
 * Check the code. On success the number is live: the worker profile opens and
 * the agent introduces itself, which is also the first real proof the thread
 * works in both directions.
 */
export async function verifySignup(auth0_sub: string, code: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id, phone, display_name, phone_verified
         FROM people
        WHERE auth0_sub = $1
        FOR UPDATE`,
      [auth0_sub],
    );
    const person = found.rows[0];
    if (!person) {
      await client.query("ROLLBACK");
      return { error: "no_account" as const };
    }
    if (person.phone_verified) {
      await client.query("COMMIT");
      return { verified: true as const, phone: person.phone };
    }

    const pending = await client.query(
      `SELECT code, attempts, expires_at
         FROM phone_verifications
        WHERE phone = $1
        FOR UPDATE`,
      [person.phone],
    );
    const row = pending.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { error: "no_code" as const };
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return { error: "expired" as const };
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await client.query("ROLLBACK");
      return { error: "too_many_attempts" as const };
    }

    if (String(code).trim() !== row.code) {
      await client.query(
        `UPDATE phone_verifications SET attempts = attempts + 1 WHERE phone = $1`,
        [person.phone],
      );
      await client.query("COMMIT");
      return { error: "wrong_code" as const, attempts_left: MAX_ATTEMPTS - (row.attempts + 1) };
    }

    await client.query(
      `UPDATE phone_verifications SET verified_at = now() WHERE phone = $1`,
      [person.phone],
    );
    await client.query(
      `UPDATE people
          SET phone_verified = true,
              doc = jsonb_set(
                COALESCE(doc, '{}'::jsonb),
                '{availability}',
                COALESCE(doc->'availability', '{}'::jsonb)
                  || jsonb_build_object(
                    'isAvailable',
                    COALESCE((doc->>'wantsWork')::boolean, true)
                  )
              )
        WHERE id = $1`,
      [person.id],
    );
    await client.query(
      `UPDATE worker_profiles w
          SET is_available = COALESCE((p.doc->>'wantsWork')::boolean, true),
              updated_at = now()
         FROM people p
        WHERE p.id = w.person_id AND p.id = $1`,
      [person.id],
    );

    // Only the transaction that first proves the phone can enqueue onboarding.
    await client.query(
      `INSERT INTO agent_handoffs (person_id, phone, kind, payload)
       SELECT $1,$2,'welcome',$3::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM agent_handoffs WHERE person_id = $1 AND kind = 'welcome'
        )`,
      [
        person.id,
        person.phone,
        JSON.stringify({
          source: "web_signup",
          display_name: person.display_name,
          note: "They just finished signing up on the site and verified this number.",
        }),
      ],
    );
    await client.query("COMMIT");
    return { verified: true as const, phone: person.phone };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** What the site shows a signed-in person about their own account. */
export async function signupStatus(auth0_sub: string) {
  const { rows } = await pool.query(
    `SELECT p.id, p.phone, p.display_name, p.email, p.phone_verified, p.signed_up_at,
            w.is_available, w.blurb, w.categories, w.min_price_usd,
            (SELECT count(*) FROM orders o WHERE o.person_id = p.id)::int AS requests_made,
            (SELECT count(*) FROM job_offers j
              WHERE j.phone = p.phone AND j.status = 'accepted')::int AS jobs_taken
       FROM people p
       LEFT JOIN worker_profiles w ON w.person_id = p.id
      WHERE p.auth0_sub = $1`,
    [auth0_sub],
  );
  return rows[0] ?? null;
}

/** Let someone step out of, or back into, the pool. */
export async function setAvailability(auth0_sub: string, available: boolean) {
  const { rows } = await pool.query(
    `UPDATE worker_profiles w
        SET is_available = ($2 AND p.phone_verified), updated_at = now()
       FROM people p
      WHERE p.id = w.person_id AND p.auth0_sub = $1
      RETURNING w.is_available, w.person_id`,
    [auth0_sub, available],
  );
  if (!rows[0]) return { error: "no_profile" as const };
  await pool.query(
    `UPDATE people
        SET doc = jsonb_set(
              COALESCE(doc, '{}'::jsonb),
              '{availability}',
              COALESCE(doc->'availability', '{}'::jsonb) || $2::jsonb
            )
      WHERE id = $1`,
    [rows[0].person_id, JSON.stringify({ isAvailable: Boolean(rows[0].is_available) })],
  );
  return { is_available: rows[0].is_available };
}
