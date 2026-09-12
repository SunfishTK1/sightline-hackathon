import { pool, normalizePhone, upsertPerson } from "./db.js";

export type PersonStyle = {
  summary: string;
  style_tag: string;
  updated_at: string;
};

/**
 * Written by the personal agent after it has learned enough from someone's
 * own messages. The embedding is stored for the agent's own use in picking
 * the closest style archetype - it is never handed back over the API.
 */
export async function saveStyle(
  phone: string,
  summary: string,
  styleTag: string,
  embedding: number[],
): Promise<void> {
  const e164 = normalizePhone(phone);
  const person = await upsertPerson(e164);
  await pool.query(
    `INSERT INTO person_style (person_id, summary, style_tag, embedding, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (person_id) DO UPDATE
       SET summary = EXCLUDED.summary, style_tag = EXCLUDED.style_tag,
           embedding = EXCLUDED.embedding, updated_at = now()`,
    [person.id, summary, styleTag, JSON.stringify(embedding)],
  );
}

export async function getStyleByPersonId(personId: string): Promise<PersonStyle | null> {
  const { rows } = await pool.query(
    `SELECT summary, style_tag, updated_at FROM person_style WHERE person_id = $1`,
    [personId],
  );
  return rows[0] ?? null;
}
