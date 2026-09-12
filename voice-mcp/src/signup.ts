/**
 * Web signup. Someone who signs up on the site becomes the same kind of
 * participant as someone who called in: one `people` row keyed on their phone,
 * plus a worker profile if they are willing to take work.
 *
 * The phone is the identity here - it is what the agent texts - so a number
 * is not live until a code sent to it comes back. Until then the person exists
 * but is not in the pool, and nothing automated ever reaches them.
 */
import { pool, normalizePhone, upsertPerson } from "./db.js";

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

  // A phone already in use by a different account is a conflict, not an
  // update: it would quietly hand one person's thread to another.
  const clash = await pool.query(
    `SELECT auth0_sub FROM people WHERE phone = $1 AND auth0_sub IS NOT NULL AND auth0_sub <> $2`,
    [e164, input.auth0_sub],
  );
  if (clash.rowCount) {
    return { error: "phone_in_use" as const };
  }

  const person = await upsertPerson(e164, input.display_name);
  const { rows } = await pool.query(
    `UPDATE people
        SET auth0_sub = $2,
            email = COALESCE($3, email),
            signed_up_at = COALESCE(signed_up_at, now()),
            phone_verified = CASE WHEN phone = $4 AND phone_verified THEN true ELSE false END
      WHERE id = $1
      RETURNING id, phone, display_name, email, phone_verified`,
    [person.id, input.auth0_sub, input.email || null, e164],
  );
  const saved = rows[0];

  // A worker profile exists from the moment they say they want work, but it is
  // unavailable until the number is proven - an unverified number must never
  // be offered a job.
  if (input.wants_work !== false) {
    await pool.query(
      `INSERT INTO worker_profiles (person_id, phone, is_available, blurb, categories, min_price_usd, updated_at)
       VALUES ($1,$2,$3,$4,$5::text[],$6, now())
       ON CONFLICT (person_id) DO UPDATE
         SET phone = EXCLUDED.phone,
             is_available = EXCLUDED.is_available,
             blurb = COALESCE(EXCLUDED.blurb, worker_profiles.blurb),
             categories = EXCLUDED.categories,
             min_price_usd = COALESCE(EXCLUDED.min_price_usd, worker_profiles.min_price_usd),
             updated_at = now()`,
      [
        saved.id,
        e164,
        Boolean(saved.phone_verified),
        input.blurb ?? null,
        input.categories ?? [],
        input.min_price_usd ?? null,
      ],
    );
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
  const found = await pool.query(
    `SELECT id, phone, display_name FROM people WHERE auth0_sub = $1`,
    [auth0_sub],
  );
  const person = found.rows[0];
  if (!person) return { error: "no_account" as const };

  const pending = await pool.query(
    `SELECT code, attempts, expires_at FROM phone_verifications WHERE phone = $1`,
    [person.phone],
  );
  const row = pending.rows[0];
  if (!row) return { error: "no_code" as const };
  if (new Date(row.expires_at).getTime() < Date.now()) return { error: "expired" as const };
  if (row.attempts >= MAX_ATTEMPTS) return { error: "too_many_attempts" as const };

  if (String(code).trim() !== row.code) {
    await pool.query(
      `UPDATE phone_verifications SET attempts = attempts + 1 WHERE phone = $1`,
      [person.phone],
    );
    return { error: "wrong_code" as const, attempts_left: MAX_ATTEMPTS - (row.attempts + 1) };
  }

  await pool.query(
    `UPDATE phone_verifications SET verified_at = now() WHERE phone = $1`,
    [person.phone],
  );
  await pool.query(`UPDATE people SET phone_verified = true WHERE id = $1`, [person.id]);
  await pool.query(
    `UPDATE worker_profiles SET is_available = true, updated_at = now() WHERE person_id = $1`,
    [person.id],
  );

  // Hand the new account to the agent so it opens the conversation itself,
  // rather than the person's first text arriving with no context.
  await pool.query(
    `INSERT INTO agent_handoffs (person_id, phone, kind, payload)
     VALUES ($1,$2,'welcome',$3::jsonb)`,
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

  return { verified: true as const, phone: person.phone };
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
      RETURNING w.is_available`,
    [auth0_sub, available],
  );
  if (!rows[0]) return { error: "no_profile" as const };
  return { is_available: rows[0].is_available };
}
