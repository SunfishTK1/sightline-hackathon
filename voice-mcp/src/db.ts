import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Railway's private network speaks plaintext; anything else (public proxy,
// managed host) expects TLS.
const isInternal = connectionString.includes(".railway.internal");

export const pool = new Pool({
  connectionString,
  ssl: isInternal ? undefined : { rejectUnauthorized: false },
  max: 5,
});

/**
 * Create the schema on boot. The service is the only writer, and Railway's
 * database is only reachable from inside the project, so migrating at startup
 * beats needing a local connection to run migrations.
 */
export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS people (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone         text UNIQUE NOT NULL,
      display_name  text,
      created_at    timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS calls (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      person_id         uuid REFERENCES people(id) ON DELETE SET NULL,
      caller_phone      text NOT NULL,
      agent             text NOT NULL DEFAULT 'grok-voice',
      external_call_id  text,
      status            text NOT NULL DEFAULT 'open',
      summary           text,
      resolution        text,
      resolution_status text,
      metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
      started_at        timestamptz NOT NULL DEFAULT now(),
      ended_at          timestamptz
    );

    CREATE TABLE IF NOT EXISTS call_notes (
      id        bigserial PRIMARY KEY,
      call_id   uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      speaker   text NOT NULL,
      kind      text NOT NULL DEFAULT 'utterance',
      text      text NOT NULL,
      at        timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      person_id         uuid REFERENCES people(id) ON DELETE SET NULL,
      call_id           uuid REFERENCES calls(id) ON DELETE SET NULL,
      source            text NOT NULL DEFAULT 'voice',
      title             text NOT NULL,
      details           text NOT NULL,
      category          text,
      pickup_location   text,
      dropoff_location  text,
      deadline_at       timestamptz,
      budget_usd        numeric(10,2),
      urgency           text,
      requirements      jsonb NOT NULL DEFAULT '[]'::jsonb,
      status            text NOT NULL DEFAULT 'submitted',
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    );

    -- What the iMessage agent picks up: "here's what the call covered".
    CREATE TABLE IF NOT EXISTS agent_handoffs (
      id            bigserial PRIMARY KEY,
      person_id     uuid REFERENCES people(id) ON DELETE SET NULL,
      phone         text NOT NULL,
      call_id       uuid REFERENCES calls(id) ON DELETE SET NULL,
      order_id      uuid REFERENCES orders(id) ON DELETE SET NULL,
      kind          text NOT NULL,
      payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at    timestamptz NOT NULL DEFAULT now(),
      delivered_at  timestamptz
    );

    -- Supply side: who is willing to pick up work, and what they'll take.
    CREATE TABLE IF NOT EXISTS worker_profiles (
      person_id      uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
      phone          text UNIQUE NOT NULL,
      is_available   boolean NOT NULL DEFAULT true,
      blurb          text,
      categories     text[] NOT NULL DEFAULT '{}',
      min_price_usd  numeric(10,2),
      updated_at     timestamptz NOT NULL DEFAULT now()
    );

    -- One row per person the marketplace agent solicited for one order.
    CREATE TABLE IF NOT EXISTS job_offers (
      id                bigserial PRIMARY KEY,
      order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      person_id         uuid REFERENCES people(id) ON DELETE SET NULL,
      phone             text NOT NULL,
      status            text NOT NULL DEFAULT 'offered',
      reason            text,
      outreach_sent_at  timestamptz,
      responded_at      timestamptz,
      created_at        timestamptz NOT NULL DEFAULT now()
    );

    -- How much their agent may do on their behalf.
    ALTER TABLE worker_profiles ADD COLUMN IF NOT EXISTS auto_counter boolean NOT NULL DEFAULT true;
    ALTER TABLE worker_profiles ADD COLUMN IF NOT EXISTS auto_accept boolean NOT NULL DEFAULT false;

    -- A worker can propose different terms instead of a flat yes or no.
    ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS counter_price_usd numeric(10,2);
    ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS counter_note text;
    ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS countered_at timestamptz;
    -- Haggling has to end: counted so a negotiation cannot run forever.
    ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS counter_rounds int NOT NULL DEFAULT 0;
    ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS offered_usd numeric(10,2);
    ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS travel_note text;

    -- A worker's agent asking the requester something about the job, rather
    -- than the job stalling on a detail nobody clarified.
    CREATE TABLE IF NOT EXISTS job_questions (
      id           bigserial PRIMARY KEY,
      offer_id     bigint REFERENCES job_offers(id) ON DELETE CASCADE,
      order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      asker_phone  text NOT NULL,
      question     text NOT NULL,
      answer       text,
      asked_at     timestamptz NOT NULL DEFAULT now(),
      answered_at  timestamptz
    );
    CREATE INDEX IF NOT EXISTS job_questions_unanswered_idx
      ON job_questions (order_id) WHERE answered_at IS NULL;

    -- The ethics gate's verdict, and the job as first allowed. A task may flex
    -- on price or detail, but it may not become a different job.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS ethics_verdict text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS ethics_reason text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS ethics_conditions jsonb;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_structured jsonb;

    -- Web signup. A person may arrive by phone, by text, or by signing up, and
    -- all three have to land on the same row - the phone is the identity.
    ALTER TABLE people ADD COLUMN IF NOT EXISTS auth0_sub text;
    ALTER TABLE people ADD COLUMN IF NOT EXISTS email text;
    -- Defaults true so everyone already in the pool keeps working; signup sets
    -- it false until a code sent to that number comes back.
    ALTER TABLE people ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT true;
    ALTER TABLE people ADD COLUMN IF NOT EXISTS signed_up_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS people_auth0_sub_idx
      ON people (auth0_sub) WHERE auth0_sub IS NOT NULL;

    -- Nobody gets automated texts about jobs at a number they have not proven
    -- is theirs. One live code per phone; attempts are capped.
    CREATE TABLE IF NOT EXISTS phone_verifications (
      phone       text PRIMARY KEY,
      code        text NOT NULL,
      attempts    int NOT NULL DEFAULT 0,
      sent_at     timestamptz NOT NULL DEFAULT now(),
      expires_at  timestamptz NOT NULL,
      verified_at timestamptz
    );

    -- Completion: the worker says done, the requester confirms. Two steps,
    -- because neither side's word alone should release money.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS done_marked_at timestamptz;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at timestamptz;

    -- Payouts need a Stripe Connect account per worker. Until one exists and
    -- is verified, nobody can be paid - live or test.
    ALTER TABLE worker_profiles ADD COLUMN IF NOT EXISTS stripe_account_id text;
    ALTER TABLE worker_profiles ADD COLUMN IF NOT EXISTS payouts_ready boolean NOT NULL DEFAULT false;

    -- One generated illustration per task, kept so it can be reused in every
    -- offer rather than regenerated per recipient.
    CREATE TABLE IF NOT EXISTS order_images (
      order_id    uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      png         bytea NOT NULL,
      prompt      text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    -- A short clip of the finished job. Generation takes minutes, so it is
    -- stored and delivered separately from anything a person is waiting on.
    CREATE TABLE IF NOT EXISTS order_videos (
      order_id    uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      mp4         bytea NOT NULL,
      prompt      text,
      seconds     int,
      delivered_at timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id                    bigserial PRIMARY KEY,
      order_id              uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payer_id              uuid REFERENCES people(id) ON DELETE SET NULL,
      payee_id              uuid REFERENCES people(id) ON DELETE SET NULL,
      amount_usd            numeric(10,2) NOT NULL,
      platform_fee_usd      numeric(10,2) NOT NULL DEFAULT 0,
      status                text NOT NULL DEFAULT 'pending',
      stripe_mode           text,
      stripe_payment_intent text,
      note                  text,
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);

    -- One devnet wallet per person, created the first time the agent hears
    -- from them. The secret key is encrypted at rest; devnet SOL is worthless
    -- but the key format is identical to mainnet, so it is not stored in the
    -- clear.
    CREATE TABLE IF NOT EXISTS wallets (
      person_id             uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
      public_key            text UNIQUE NOT NULL,
      encrypted_secret_key  text NOT NULL,
      cluster               text NOT NULL DEFAULT 'devnet',
      funded_at             timestamptz,
      created_at            timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES people(id);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

    CREATE UNIQUE INDEX IF NOT EXISTS job_offers_order_phone_idx
      ON job_offers (order_id, phone);
    CREATE INDEX IF NOT EXISTS job_offers_open_idx ON job_offers (phone, status);
    CREATE INDEX IF NOT EXISTS job_offers_outreach_idx
      ON job_offers (created_at) WHERE outreach_sent_at IS NULL;
    CREATE INDEX IF NOT EXISTS calls_phone_idx ON calls (caller_phone, started_at DESC);
    CREATE INDEX IF NOT EXISTS call_notes_call_idx ON call_notes (call_id, at);
    CREATE INDEX IF NOT EXISTS orders_person_idx ON orders (person_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS handoffs_undelivered_idx
      ON agent_handoffs (created_at) WHERE delivered_at IS NULL;
  `);
}

/**
 * Digits in, E.164 out. Voice transcription hands over "412-555-0123".
 *
 * A mis-heard number must fail loudly: silently accepting one creates a
 * phantom person, and the task is then attributed to nobody real.
 */
export function normalizePhone(raw: string): string {
  const cleaned = (raw || "").replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");

  let e164: string;
  if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else if (cleaned.startsWith("+")) e164 = `+${digits}`;
  else e164 = `+${digits}`;

  // E.164 allows 8-15 digits; anything shorter is a transcription error.
  const count = e164.length - 1;
  if (count < 10 || count > 15) {
    throw new Error(
      `"${raw}" is not a usable phone number (${count} digits). Ask them to repeat it, including the area code.`,
    );
  }
  return e164;
}

export async function upsertPerson(phone: string, displayName?: string) {
  const { rows } = await pool.query(
    `INSERT INTO people (phone, display_name)
     VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE
       SET display_name = COALESCE(EXCLUDED.display_name, people.display_name)
     RETURNING *`,
    [phone, displayName ?? null],
  );
  return rows[0];
}
