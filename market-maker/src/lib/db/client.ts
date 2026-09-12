import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const globalForPg = globalThis as unknown as {
  _pgPool?: Pool;
};

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

export function getPool(): Pool {
  if (globalForPg._pgPool) {
    return globalForPg._pgPool;
  }

  const connectionString = getDatabaseUrl();
  const isInternal = connectionString.includes(".railway.internal");

  globalForPg._pgPool = new Pool({
    connectionString,
    ssl: isInternal ? false : { rejectUnauthorized: false },
    max: 8,
    connectionTimeoutMillis: 8000,
  });

  return globalForPg._pgPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function withClient<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (globalForPg._pgPool) {
    await globalForPg._pgPool.end();
    globalForPg._pgPool = undefined;
  }
}
