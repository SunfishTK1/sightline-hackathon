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
}
