/**
 * @owner Will
 * Create Postgres tables + pgvector (if available) on Railway.
 */
import { config } from "dotenv";
import { resolve } from "path";
import { Pool } from "pg";

config({ path: resolve(process.cwd(), ".env.local") });
config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — check gotchu/.env.local");
}

async function main() {
  const isInternal = connectionString.includes(".railway.internal");
  const pool = new Pool({
    connectionString,
    ssl: isInternal ? undefined : { rejectUnauthorized: false },
    max: 2,
  });

  let hasVector = false;
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    hasVector = true;
    console.log("pgvector extension enabled");
  } catch (err) {
    console.warn(
      "pgvector not available on this Postgres — embeddings will store as float8[].",
      err instanceof Error ? err.message : err,
    );
  }

  const embeddingCol = hasVector ? "vector(768)" : "float8[]";

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      uuid                  TEXT PRIMARY KEY,
      auth0_sub             TEXT UNIQUE NOT NULL,
      first_name            TEXT NOT NULL,
      last_name             TEXT NOT NULL,
      cmu_email             TEXT UNIQUE NOT NULL,
      phone                 TEXT NOT NULL,
      preference_text       TEXT NOT NULL,
      preference_embedding  ${embeddingCol},
      is_available          BOOLEAN NOT NULL DEFAULT false,
      available_until       TIMESTAMPTZ,
      stats                 JSONB NOT NULL DEFAULT '{"tasksCompleted":0,"tasksRequested":0,"avgRating":null,"ratingCount":0}',
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      task_id              TEXT PRIMARY KEY,
      requester_uuid       TEXT NOT NULL REFERENCES users(uuid),
      raw_text             TEXT NOT NULL,
      structured           JSONB NOT NULL,
      task_embedding       ${embeddingCol},
      ethics               JSONB,
      status               TEXT NOT NULL,
      matched_worker_uuid  TEXT REFERENCES users(uuid),
      agreed_price_usd     NUMERIC,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS offers (
      offer_id         TEXT PRIMARY KEY,
      task_id          TEXT NOT NULL REFERENCES tasks(task_id),
      worker_uuid      TEXT NOT NULL REFERENCES users(uuid),
      match_score      NUMERIC NOT NULL,
      transcript       JSONB NOT NULL DEFAULT '[]',
      outcome          TEXT NOT NULL DEFAULT 'PENDING',
      final_price_usd  NUMERIC,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (task_id, worker_uuid)
    );

    CREATE TABLE IF NOT EXISTS agreements (
      task_id                 TEXT PRIMARY KEY REFERENCES tasks(task_id),
      requester_uuid          TEXT NOT NULL REFERENCES users(uuid),
      worker_uuid             TEXT NOT NULL REFERENCES users(uuid),
      final_price_usd         NUMERIC NOT NULL,
      terms                   JSONB NOT NULL DEFAULT '[]',
      requester_approved_at   TIMESTAMPTZ,
      worker_approved_at      TIMESTAMPTZ,
      payment                 JSONB NOT NULL DEFAULT '{"method":"cash","solanaTxSig":null,"status":"unpaid"}',
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reviews (
      task_id         TEXT NOT NULL REFERENCES tasks(task_id),
      rater_uuid      TEXT NOT NULL REFERENCES users(uuid),
      rated_uuid      TEXT NOT NULL REFERENCES users(uuid),
      rating          INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      survey_answers  JSONB NOT NULL,
      comment         TEXT,
      ethics_flag     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS tasks_status_created_idx ON tasks (status, created_at DESC);
  `);

  const { rows } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  console.log(
    "Gotchu tables ready:",
    rows.map((r: { table_name: string }) => r.table_name).join(", "),
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
