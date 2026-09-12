import { pool, normalizePhone, upsertPerson } from "./db.js";

// A stored preference is replayed back to the model later as a standing
// instruction it is told to follow "over anything else." Bounding length and
// count here too, not just in the agent that calls this - anything that can
// write to this table should not be able to smuggle a paragraph of injected
// instructions through it, or grow it without limit.
const MAX_PREFERENCE_LENGTH = 100;
const MAX_PREFERENCES = 20;

function sanitizePreferences(preferences: string[]): string[] {
  return preferences
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim().slice(0, MAX_PREFERENCE_LENGTH));
}

export type PersonStyle = {
  summary: string;
  style_tag: string;
  preferences: string[];
  updated_at: string;
};

/** Everything the agent needs to decide whether - and how - to update its read on someone. */
export type FullPersonStyle = PersonStyle & { embedding: number[] };

/**
 * Written by the personal agent after it has learned enough from someone's
 * own messages. The embedding is stored for the agent's own use (comparing
 * against archetypes, detecting drift) - it is never handed back over the
 * public identify_caller response, only through the internal /full lookup.
 */
export async function saveStyle(
  phone: string,
  summary: string,
  styleTag: string,
  embedding: number[],
  preferences: string[] = [],
): Promise<void> {
  const e164 = normalizePhone(phone);
  const person = await upsertPerson(e164);
  const clean = sanitizePreferences(preferences);
  await pool.query(
    `INSERT INTO person_style (person_id, summary, style_tag, embedding, preferences, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, now())
     ON CONFLICT (person_id) DO UPDATE
       SET summary = EXCLUDED.summary, style_tag = EXCLUDED.style_tag,
           embedding = EXCLUDED.embedding,
           -- Explicit preferences accumulate - a new batch adds to what was
           -- already said, rather than erasing an earlier "no emojis" just
           -- because this round of learning didn't happen to restate it.
           -- Capped so this can never grow without bound.
           preferences = (
             SELECT COALESCE(jsonb_agg(pref), '[]'::jsonb)
               FROM (
                 SELECT DISTINCT pref
                   FROM jsonb_array_elements(person_style.preferences || EXCLUDED.preferences) AS pref
                  LIMIT ${MAX_PREFERENCES}
               ) capped
           ),
           updated_at = now()`,
    [person.id, summary, styleTag, JSON.stringify(embedding), JSON.stringify(clean)],
  );
}

/** Add preferences without touching the inferred summary/tone - used when tone hasn't shifted. */
export async function addPreferences(phone: string, preferences: string[]): Promise<void> {
  const clean = sanitizePreferences(preferences);
  if (!clean.length) return;
  const e164 = normalizePhone(phone);
  const person = await upsertPerson(e164);
  await pool.query(
    `UPDATE person_style
        SET preferences = (
              SELECT COALESCE(jsonb_agg(pref), '[]'::jsonb)
                FROM (
                  SELECT DISTINCT pref
                    FROM jsonb_array_elements(preferences || $2::jsonb) AS pref
                   LIMIT ${MAX_PREFERENCES}
                ) capped
            ),
            updated_at = now()
      WHERE person_id = $1`,
    [person.id, JSON.stringify(clean)],
  );
}

export async function getStyleByPersonId(personId: string): Promise<PersonStyle | null> {
  const { rows } = await pool.query(
    `SELECT summary, style_tag, preferences, updated_at FROM person_style WHERE person_id = $1`,
    [personId],
  );
  return rows[0] ?? null;
}

/** Internal, server-to-server only: includes the embedding, for the agent's own drift check. */
export async function getFullStyle(phone: string): Promise<FullPersonStyle | null> {
  const e164 = normalizePhone(phone);
  const person = await upsertPerson(e164);
  const { rows } = await pool.query(
    `SELECT summary, style_tag, preferences, embedding, updated_at
       FROM person_style WHERE person_id = $1`,
    [person.id],
  );
  return rows[0] ?? null;
}
