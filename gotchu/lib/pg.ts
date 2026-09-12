/**
 * @owner Will
 * Cached pg.Pool. Public Railway proxy needs TLS; *.railway.internal does not.
 */
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _gotchuPgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const isInternal = connectionString.includes(".railway.internal");
  return new Pool({
    connectionString,
    ssl: isInternal ? undefined : { rejectUnauthorized: false },
    max: 5,
  });
}

export function getPool(): Pool {
  if (process.env.NODE_ENV === "development") {
    global._gotchuPgPool ??= createPool();
    return global._gotchuPgPool;
  }
  return createPool();
}

export function postgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
