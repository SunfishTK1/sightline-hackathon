import { Pool } from "pg";
import { config } from "./config.js";

const isInternal = config.databaseUrl.includes(".railway.internal");

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isInternal ? undefined : { rejectUnauthorized: false },
  max: 5,
});

export type Turn = {
  role: "user" | "assistant" | "tool";
  content: string;
  /** ISO timestamp, so the agent can tell a reply from a minute ago from one from yesterday. */
  at?: string;
  /** Tool name, when role is "tool". */
  name?: string;
};

/**
 * The agent's own tables. Domain tables (people, calls, orders, handoffs) belong
 * to the MCP service, which stays their only writer.
 */
export async function ensureAgentSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      phone       text PRIMARY KEY,
      turns       jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS relay_state (
      id      int PRIMARY KEY DEFAULT 1,
      cursor  bigint NOT NULL DEFAULT 0
    );

    -- Belt and braces against double-texting: the relay can redeliver an event.
    -- A claim is only final once the reply is actually sent, so a restart
    -- mid-turn leaves a stale claim that becomes eligible again.
    CREATE TABLE IF NOT EXISTS handled_events (
      event_id     text PRIMARY KEY,
      handled_at   timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE handled_events ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'done';
    ALTER TABLE handled_events ADD COLUMN IF NOT EXISTS claimed_at timestamptz NOT NULL DEFAULT now();

    -- Delivery bookkeeping for handoffs. A 202 from the relay means submitted,
    -- not delivered, so we hold the handoff open until the Mac observes it.
    CREATE TABLE IF NOT EXISTS handoff_attempts (
      handoff_id   text PRIMARY KEY,
      request_id   text,
      attempts     int NOT NULL DEFAULT 0,
      last_error   text,
      updated_at   timestamptz NOT NULL DEFAULT now()
    );

    -- What each outbound message was about, so an inline reply to it can be
    -- resolved to the exact job or request being answered.
    CREATE TABLE IF NOT EXISTS sent_messages (
      request_id  text PRIMARY KEY,
      phone       text NOT NULL,
      kind        text NOT NULL,
      ref_id      text,
      text        text NOT NULL,
      at          timestamptz NOT NULL DEFAULT now()
    );

    -- How many times we have chased one stuck thing, so the escalation
    -- ladder climbs instead of repeating itself forever.
    CREATE TABLE IF NOT EXISTS nudges (
      key        text PRIMARY KEY,
      phone      text NOT NULL,
      strikes    int NOT NULL DEFAULT 0,
      last_at    timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS outreach_attempts (
      offer_id     text PRIMARY KEY,
      attempts     int NOT NULL DEFAULT 0,
      updated_at   timestamptz NOT NULL DEFAULT now()
    );
  `);
}

/** Outreach that cannot be delivered must stop, not retry every 5 seconds. */
export async function bumpOutreachAttempt(offerId: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO outreach_attempts (offer_id, attempts, updated_at)
     VALUES ($1, 1, now())
     ON CONFLICT (offer_id) DO UPDATE
       SET attempts = outreach_attempts.attempts + 1, updated_at = now()
     RETURNING attempts`,
    [offerId],
  );
  return Number(rows[0].attempts);
}

/** Records a chase and returns which strike this is. */
export async function bumpNudge(key: string, phone: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO nudges (key, phone, strikes, last_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (key) DO UPDATE
       SET strikes = nudges.strikes + 1, last_at = now()
     RETURNING strikes`,
    [key, phone],
  );
  return Number(rows[0].strikes);
}

/** Minutes since this thing was last chased, or null if never. */
export async function minutesSinceNudge(key: string): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (now() - last_at))/60 AS mins, strikes
       FROM nudges WHERE key = $1`,
    [key],
  );
  return rows[0] ? Number(rows[0].mins) : null;
}

export type SentMessage = {
  request_id: string;
  phone: string;
  kind: string;
  ref_id: string | null;
  text: string;
};

export async function recordSent(
  requestId: string | undefined,
  phone: string,
  kind: string,
  refId: string | null,
  text: string,
): Promise<void> {
  if (!requestId) return;
  await pool.query(
    `INSERT INTO sent_messages (request_id, phone, kind, ref_id, text)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (request_id) DO NOTHING`,
    [requestId, phone, kind, refId, text],
  );
}

/** Which of our messages is this inline reply answering? */
export async function findSent(requestId: string): Promise<SentMessage | null> {
  const { rows } = await pool.query(
    `SELECT request_id, phone, kind, ref_id, text FROM sent_messages WHERE request_id = $1`,
    [requestId],
  );
  return rows[0] ?? null;
}

export type HandoffAttempt = {
  handoff_id: string;
  request_id: string | null;
  attempts: number;
  last_error: string | null;
};

export async function getAttempt(handoffId: string): Promise<HandoffAttempt | null> {
  const { rows } = await pool.query(
    `SELECT handoff_id, request_id, attempts, last_error
       FROM handoff_attempts WHERE handoff_id = $1`,
    [handoffId],
  );
  return rows[0] ?? null;
}

export async function recordAttempt(
  handoffId: string,
  requestId: string | null,
  lastError: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO handoff_attempts (handoff_id, request_id, attempts, last_error, updated_at)
     VALUES ($1, $2, 1, $3, now())
     ON CONFLICT (handoff_id) DO UPDATE
       SET request_id = EXCLUDED.request_id,
           attempts = handoff_attempts.attempts + 1,
           last_error = EXCLUDED.last_error,
           updated_at = now()`,
    [handoffId, requestId, lastError],
  );
}

export async function getCursor(): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO relay_state (id, cursor) VALUES (1, 0)
     ON CONFLICT (id) DO UPDATE SET cursor = relay_state.cursor
     RETURNING cursor`,
  );
  return Number(rows[0].cursor);
}

export async function setCursor(cursor: number): Promise<void> {
  await pool.query(`UPDATE relay_state SET cursor = $1 WHERE id = 1`, [cursor]);
}

/** How long a crashed turn holds its claim before another pass may retry it. */
const CLAIM_STALE_MINUTES = 2;

/**
 * Take ownership of an event. Returns false if it is already answered, or if
 * another pass is working on it right now. A claim left behind by a crash or a
 * redeploy expires, so the message gets answered late instead of never.
 */
export async function claimEvent(eventId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO handled_events (event_id, status, claimed_at)
     VALUES ($1, 'processing', now())
     ON CONFLICT (event_id) DO UPDATE
       SET status = 'processing', claimed_at = now()
     WHERE handled_events.status = 'processing'
       AND handled_events.claimed_at < now() - interval '${CLAIM_STALE_MINUTES} minutes'
     RETURNING event_id`,
    [eventId],
  );
  return (rowCount ?? 0) > 0;
}

/** Called once the reply is actually on its way. */
export async function completeEvent(eventId: string): Promise<void> {
  await pool.query(
    `UPDATE handled_events SET status = 'done', handled_at = now() WHERE event_id = $1`,
    [eventId],
  );
}

/** Conversation state is per phone number: one thread per person, never shared. */
export async function loadTurns(phone: string): Promise<Turn[]> {
  const { rows } = await pool.query(`SELECT turns FROM conversations WHERE phone = $1`, [
    phone,
  ]);
  return (rows[0]?.turns as Turn[]) ?? [];
}

export async function saveTurns(phone: string, turns: Turn[]): Promise<void> {
  const trimmed = turns.slice(-config.historyTurns);
  await pool.query(
    `INSERT INTO conversations (phone, turns, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (phone) DO UPDATE SET turns = EXCLUDED.turns, updated_at = now()`,
    [phone, JSON.stringify(trimmed)],
  );
}
