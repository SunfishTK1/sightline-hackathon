import { query } from "./client";

export async function getState<T>(key: string, fallback: T): Promise<T> {
  const result = await query<{ value: T }>(
    "SELECT value FROM app_state WHERE key = $1",
    [key],
  );
  return result.rows[0]?.value ?? fallback;
}

export async function setState(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}
