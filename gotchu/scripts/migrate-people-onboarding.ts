/**
 * @owner Will
 * Onboarding writes to the real `people` table (shared with the
 * texting/matching backend) instead of the `users` table, which is
 * test data only. Additive + idempotent: adds the columns onboarding
 * needs without touching people's existing phone/display_name rows.
 */
import { config } from "dotenv";
import { resolve } from "path";
import { Pool } from "pg";

config({ path: resolve(process.cwd(), ".env.local") });
config();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — check gotchu/.env.local");
  }

  const isInternal = connectionString.includes(".railway.internal");
  const pool = new Pool({
    connectionString,
    ssl: isInternal ? undefined : { rejectUnauthorized: false },
    max: 2,
  });

  await pool.query(`
    ALTER TABLE people
      ADD COLUMN IF NOT EXISTS email TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS doc JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS avatar_data_url TEXT;
  `);

  console.log("people table ready for onboarding: email (unique), doc, updated_at, avatar_data_url.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
