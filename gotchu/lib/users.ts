/**
 * @owner Will
 * Onboarding persists against the real `people` table — the identity
 * table the texting/matching backend already uses (worker_profiles,
 * orders, payments, calls all FK to people.id). The old `users` table
 * is test data only; nothing here writes to it anymore.
 *
 * people(id uuid pk, phone text unique, display_name, email unique,
 * doc jsonb, created_at, updated_at)
 */
import type { User } from "./types/user";
import { auth0ManagementConfigured, isAuth0UserVerified } from "./auth0-management";
import { getPool, postgresConfigured } from "./pg";

declare global {
  // eslint-disable-next-line no-var
  var _gotchuUsers: Map<string, User> | undefined;
}

function memory(): Map<string, User> {
  if (!global._gotchuUsers) global._gotchuUsers = new Map();
  return global._gotchuUsers;
}

type PersonRow = {
  id: string;
  phone: string;
  display_name: string | null;
  email: string | null;
  avatar_data_url: string | null;
  doc: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function fromRow(row: PersonRow): User {
  const doc = row.doc ?? {};
  const [nameFirst, ...nameRest] = (row.display_name ?? "").trim().split(/\s+/);
  return {
    uuid: row.id,
    auth0Sub: String(doc.auth0Sub ?? ""),
    firstName: String(doc.firstName ?? nameFirst ?? ""),
    lastName: String(doc.lastName ?? nameRest.join(" ")),
    cmuEmail: row.email ?? "",
    phone: row.phone,
    emailVerified: Boolean(doc.emailVerified ?? false),
    emailVerifiedAt: typeof doc.emailVerifiedAt === "string" ? doc.emailVerifiedAt : undefined,
    photoDataUrl: row.avatar_data_url ?? undefined,
    preferenceText: String(doc.preferenceText ?? ""),
    preferenceEmbedding: Array.isArray(doc.preferenceEmbedding)
      ? (doc.preferenceEmbedding as number[])
      : [],
    consents: (doc.consents as User["consents"]) ?? {
      age18: false,
      canCall: false,
      canText: false,
      acceptedTerms: false,
      termsVersion: "",
      canUseLikeness: false,
      acceptedAt: "",
    },
    availability: (doc.availability as User["availability"]) ?? {
      isAvailable: false,
    },
    stats: (doc.stats as User["stats"]) ?? {
      tasksCompleted: 0,
      tasksRequested: 0,
      avgRating: null,
      ratingCount: 0,
    },
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

function toDoc(user: User, previous: Record<string, unknown> | null): Record<string, unknown> {
  return {
    ...previous,
    auth0Sub: user.auth0Sub,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerified: user.emailVerified,
    emailVerifiedAt: user.emailVerifiedAt,
    preferenceText: user.preferenceText,
    preferenceEmbedding: user.preferenceEmbedding,
    consents: user.consents,
    availability: user.availability,
    stats: user.stats,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class PhoneAlreadyRegisteredError extends Error {}

export function publicUser(user: User): Omit<User, "preferenceEmbedding" | "auth0Sub"> & {
  auth0Sub: string;
  preferenceEmbeddingDims: number;
} {
  const { preferenceEmbedding, ...rest } = user;
  return {
    ...rest,
    preferenceEmbeddingDims: preferenceEmbedding.length,
  };
}

export async function findUserByAuth0Sub(auth0Sub: string): Promise<User | null> {
  if (postgresConfigured()) {
    const { rows } = await getPool().query<PersonRow>(
      "SELECT * FROM people WHERE auth0_sub = $1 OR doc->>'auth0Sub' = $1 LIMIT 1",
      [auth0Sub],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }
  return [...memory().values()].find((user) => user.auth0Sub === auth0Sub) ?? null;
}

export async function findUserByCmuEmail(email: string): Promise<User | null> {
  if (postgresConfigured()) {
    const { rows } = await getPool().query<PersonRow>(
      "SELECT * FROM people WHERE email = $1 LIMIT 1",
      [email],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }
  return [...memory().values()].find((user) => user.cmuEmail === email) ?? null;
}

export async function findUserByUuid(uuid: string): Promise<User | null> {
  if (postgresConfigured()) {
    const { rows } = await getPool().query<PersonRow>(
      "SELECT * FROM people WHERE id = $1 LIMIT 1",
      [uuid],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }
  return memory().get(uuid) ?? null;
}

/**
 * The CMU email is the durable identity key — unlike phone or name, a
 * student can't change it — so "already registered" is decided by email
 * alone. `wasExisting` tells the caller whether a prior registration
 * under this email was found, so the UI can say "updated" vs "joined."
 *
 * A phone number is still unique in `people` (the texting/matching
 * backend's constraint, not ours), and can already belong to a bare
 * contact stub with no email yet (someone the agent has texted but who
 * never onboarded) — claiming that stub is fine. A phone already tied
 * to a *different* verified email is a real conflict and is rejected
 * rather than silently merged into the wrong person.
 */
export async function upsertUser(user: User): Promise<{ user: User; wasExisting: boolean }> {
  if (postgresConfigured()) {
    const pool = getPool();

    const byEmail = await pool.query<PersonRow>(
      "SELECT * FROM people WHERE email = $1 LIMIT 1",
      [user.cmuEmail],
    );
    let target = byEmail.rows[0] ?? null;
    const wasExisting = Boolean(target);

    const byPhone = await pool.query<PersonRow>(
      "SELECT * FROM people WHERE phone = $1 LIMIT 1",
      [user.phone],
    );
    const phoneOwner = byPhone.rows[0] ?? null;
    if (phoneOwner && phoneOwner.id !== target?.id) {
      // Claiming a bare contact stub (agent-known number, no email yet) is
      // allowed on first insert. A phone already tied to a different email
      // — or to another onboarded person — is a real conflict.
      if (phoneOwner.email && phoneOwner.email !== user.cmuEmail) {
        throw new PhoneAlreadyRegisteredError(
          "That phone number is already registered under a different CMU email.",
        );
      }
      if (target) {
        throw new PhoneAlreadyRegisteredError(
          "That phone number is already registered under a different CMU email.",
        );
      }
      target = phoneOwner;
    }

    const doc = toDoc(user, target?.doc ?? null);
    const displayName = `${user.firstName} ${user.lastName}`.trim();
    // A submission without a new photo (e.g. an update to name/phone only)
    // must not blank out one that's already saved.
    const photoDataUrl = user.photoDataUrl ?? target?.avatar_data_url ?? null;
    const auth0Sub = user.auth0Sub || null;

    const { rows } = target
      ? await pool.query<PersonRow>(
          `
          UPDATE people SET
            phone = $1,
            display_name = $2,
            email = $3,
            avatar_data_url = $4,
            doc = $5::jsonb,
            updated_at = $6,
            auth0_sub = COALESCE($8, auth0_sub),
            phone_verified = CASE
              WHEN people.phone IS DISTINCT FROM $1 THEN false
              ELSE people.phone_verified
            END
          WHERE id = $7
          RETURNING *
          `,
          [
            user.phone,
            displayName,
            user.cmuEmail,
            photoDataUrl,
            JSON.stringify(doc),
            user.updatedAt,
            target.id,
            auth0Sub,
          ],
        )
      : await pool.query<PersonRow>(
          `
          INSERT INTO people (phone, display_name, email, avatar_data_url, doc, updated_at, auth0_sub, phone_verified)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, false)
          RETURNING *
          `,
          [user.phone, displayName, user.cmuEmail, photoDataUrl, JSON.stringify(doc), user.updatedAt, auth0Sub],
        );
    if (!rows[0]) throw new Error("upsert failed");
    return { user: fromRow(rows[0]), wasExisting };
  }
  const existingMem = [...memory().values()].find((u) => u.cmuEmail === user.cmuEmail);
  const wasExisting = Boolean(existingMem);
  const uuid = existingMem?.uuid ?? user.uuid;
  const saved = { ...user, uuid };
  memory().set(uuid, saved);
  return { user: saved, wasExisting };
}

/**
 * Called on read paths (GET /api/me, the onboarding page) so a user who
 * clicked Auth0's verification link on another device sees the flip
 * without needing a callback route.
 */
export async function refreshEmailVerification(user: User): Promise<User> {
  if (user.emailVerified) return user;
  if (!auth0ManagementConfigured() || user.auth0Sub.startsWith("local|")) return user;

  const verified = await isAuth0UserVerified(user.auth0Sub).catch(() => false);
  if (!verified) return user;

  const { user: saved } = await upsertUser({
    ...user,
    emailVerified: true,
    emailVerifiedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return saved;
}
