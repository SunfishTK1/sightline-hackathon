import type { User } from "@/lib/market/types";
import { normalizePhone } from "@/lib/phone";
import { query } from "./client";
import { fromJson, toJson } from "./json";

export async function upsertUser(user: User): Promise<void> {
  await query(
    `INSERT INTO users (uuid, cmu_email, phone, doc, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (uuid) DO UPDATE SET
       cmu_email = EXCLUDED.cmu_email,
       phone = EXCLUDED.phone,
       doc = EXCLUDED.doc,
       updated_at = EXCLUDED.updated_at`,
    [
      user.uuid,
      user.cmuEmail.toLowerCase(),
      normalizePhone(user.phone),
      toJson(user),
      user.createdAt,
      user.updatedAt,
    ],
  );
}

export async function findUserByUuid(uuid: string): Promise<User | null> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM users WHERE uuid = $1",
    [uuid],
  );
  return result.rows[0] ? fromJson<User>(result.rows[0].doc) : null;
}

export async function findUserByPhone(phone: string): Promise<User | null> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM users WHERE phone = $1",
    [normalizePhone(phone)],
  );
  return result.rows[0] ? fromJson<User>(result.rows[0].doc) : null;
}

export async function findUserByEmail(cmuEmail: string): Promise<User | null> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM users WHERE cmu_email = $1",
    [cmuEmail.toLowerCase()],
  );
  return result.rows[0] ? fromJson<User>(result.rows[0].doc) : null;
}

export async function listEnabledWorkers(): Promise<User[]> {
  const result = await query<{ doc: unknown }>(
    `SELECT doc FROM users
     WHERE (doc->'workerProfile'->>'enabled')::boolean = true`,
  );
  return result.rows.map((row) => fromJson<User>(row.doc));
}

export async function findUsersByUuids(uuids: string[]): Promise<User[]> {
  if (uuids.length === 0) return [];
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM users WHERE uuid = ANY($1::text[])",
    [uuids],
  );
  return result.rows.map((row) => fromJson<User>(row.doc));
}

export async function listUsersPublic(): Promise<Omit<User, "preferenceEmbedding">[]> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc - 'preferenceEmbedding' AS doc FROM users ORDER BY doc->>'lastName'",
  );
  return result.rows.map((row) => fromJson<Omit<User, "preferenceEmbedding">>(row.doc));
}
