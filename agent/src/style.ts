import { config } from "./config.js";
import type { Turn } from "./db.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Fixed points to place someone's inferred style against, rather than
 * inventing free-form tags per person. Each is written the way it should
 * eventually read back to the model as an instruction.
 */
const STYLE_ARCHETYPES = [
  {
    tag: "terse",
    description:
      "Keep replies as short as possible - a few words when that's enough. Skip pleasantries, small talk, and restating what they said.",
  },
  {
    tag: "warm",
    description:
      "They respond well to a warm, friendly tone with some personality - not just transactional. A little more conversational than the bare minimum is welcome.",
  },
  {
    tag: "detailed",
    description:
      "They want the reasoning, not just the answer - a bit more context and explanation than usual is welcome, even within the character limit.",
  },
  {
    tag: "efficient",
    description:
      "They want fast, confident answers and dislike being asked clarifying questions - make a reasonable assumption and say what you assumed, rather than asking.",
  },
] as const;

export type StyleTag = (typeof STYLE_ARCHETYPES)[number]["tag"];

export type PersonStyle = { summary: string; style_tag: string; preferences: string[] };

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
  const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const vector = body.data?.[0]?.embedding;
  if (!vector) throw new Error("embeddings response had no vector");
  return vector;
}

// Computed once per process, not per call - the archetype list is fixed.
let archetypeEmbeddings: Promise<Array<{ tag: string; description: string; vector: number[] }>> | null = null;
function loadArchetypeEmbeddings() {
  archetypeEmbeddings ??= Promise.all(
    STYLE_ARCHETYPES.map(async (a) => ({ ...a, vector: await embed(a.description) })),
  );
  return archetypeEmbeddings;
}

function nearestArchetype(vector: number[], archetypes: Array<{ tag: string; vector: number[] }>) {
  let best = archetypes[0];
  let bestScore = -Infinity;
  for (const a of archetypes) {
    const score = cosine(vector, a.vector);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

async function callModel(instructions: string, input: string, maxTokens: number): Promise<string> {
  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.model, instructions, input, max_output_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`model HTTP ${res.status}`);
  const body = (await res.json()) as any;
  return (body.output ?? [])
    .flatMap((item: any) => item.content ?? [])
    .filter((c: any) => c.type === "output_text" || c.type === "text")
    .map((c: any) => c.text)
    .join(" ")
    .trim();
}

/**
 * Things this person said outright about how they want to be talked to -
 * "keep it short", "stop with the emojis", "call me Wil" - as opposed to a
 * tone inferred from how they happen to write. An explicit ask is a hard
 * directive; inferred style is a suggestion. Kept separate for exactly that
 * reason - one should never get overwritten or diluted by the other.
 */
async function extractExplicitPreferences(turns: Turn[]): Promise<string[]> {
  const theirs = turns.filter((t) => t.role === "user").slice(-15);
  if (!theirs.length) return [];
  try {
    const text = await callModel(
      "Scan these messages for anything this person explicitly said about how they want to be " +
        "talked to or addressed - tone, length, language, formality, a name to use, things to " +
        "avoid. Do NOT include what they asked for done (tasks, prices, logistics) - only " +
        "communication preferences stated about the conversation itself. " +
        'Return a JSON array of short imperative strings, e.g. ["Keep replies to one sentence", ' +
        '"Don\'t use emojis"]. Return [] if nothing like that was said. Return only the JSON array.',
      theirs.map((t) => `"${t.content}"`).join("\n"),
      150,
    );
    const parsed = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string" && p.trim()).slice(0, 8) : [];
  } catch {
    return [];
  }
}

/**
 * One or two sentences on how this person writes and what they seem to want,
 * folding in what was already known rather than starting over each time -
 * an evolving read on them, not a snapshot of the last fifteen messages.
 */
async function mergeSummary(turns: Turn[], prior: string | null): Promise<string | null> {
  const theirs = turns.filter((t) => t.role === "user").slice(-15);
  if (theirs.length < 3) return null;

  const instructions = prior
    ? "You maintain a running read on how one specific person writes and what they want from an " +
      "automated agent. Here is what you already believed about them, and a fresh batch of their " +
      "messages. Update your read in at most two sentences: keep what still holds, adjust what the " +
      "new messages contradict, and drop anything that no longer seems true. Base it only on their " +
      "actual wording and pacing, not on what they asked for. No preamble, just the sentences."
    : "You are building a first read on how one specific person writes and what they want from an " +
      "automated agent, from their own messages. In one sentence, describe how they write and what " +
      "kind of replies they seem to want. Base it only on their wording and pacing, not on what " +
      "they asked for. No preamble, just the sentence.";

  const input = prior
    ? `Current read: "${prior}"\n\nNew messages:\n${theirs.map((t) => `"${t.content}"`).join("\n")}`
    : theirs.map((t) => `"${t.content}"`).join("\n");

  try {
    const text = await callModel(instructions, input, 150);
    return text || null;
  } catch (err) {
    throw new Error(`style summary failed: ${(err as Error).message}`);
  }
}

/** What voice-mcp knows about this person's style right now, embedding included. */
async function fetchFullStyle(phone: string): Promise<{ summary: string; embedding: number[] } | null> {
  try {
    const res = await fetch(`${config.voiceMcpUrl}/v1/style/full?phone=${encodeURIComponent(phone)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { ok: boolean; data?: { summary: string; embedding: number[] } | null };
    return body.ok ? (body.data ?? null) : null;
  } catch {
    return null;
  }
}

// Below this cosine similarity to the prior embedding, tone is treated as
// unchanged - not worth another model call to re-describe.
const DRIFT_THRESHOLD = 0.92;

/**
 * Learn from this person's own message history and persist the result.
 * Fire-and-forget from the caller's point of view - never throws.
 *
 * Two independent tracks: explicit preferences (cheap, always extracted,
 * additive) and inferred tone (a real model call, skipped when a quick
 * embedding comparison shows their tone hasn't meaningfully moved since
 * last time - most check-ins should cost one embedding, not two model
 * calls).
 */
export async function learnStyle(phone: string, turns: Turn[]): Promise<void> {
  const recentUser = turns.filter((t) => t.role === "user").slice(-15);
  if (recentUser.length < 3) return;

  const preferences = await extractExplicitPreferences(turns).catch(() => []);

  try {
    const [rawVector, prior] = await Promise.all([
      embed(recentUser.map((t) => t.content).join("\n")),
      fetchFullStyle(phone),
    ]);

    const drift = prior ? 1 - cosine(rawVector, prior.embedding) : 1;
    if (prior && drift < 1 - DRIFT_THRESHOLD) {
      // Tone hasn't moved - still worth pushing any newly-stated preferences.
      if (preferences.length) {
        await fetch(`${config.voiceMcpUrl}/v1/style/preferences`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, preferences }),
        });
      }
      return;
    }

    const summary = await mergeSummary(turns, prior?.summary ?? null);
    if (!summary) return;

    const [summaryVector, archetypes] = await Promise.all([embed(summary), loadArchetypeEmbeddings()]);
    const best = nearestArchetype(summaryVector, archetypes);

    await fetch(`${config.voiceMcpUrl}/v1/style/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        summary,
        style_tag: best.tag,
        embedding: summaryVector,
        preferences,
      }),
    });
  } catch (err) {
    console.error(`learnStyle(${phone}) failed: ${(err as Error).message}`);
  }
}
