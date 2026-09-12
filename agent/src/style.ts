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

/**
 * One sentence on how this person writes and what they seem to want from
 * the agent, in the model's own words - not a template fill-in. Returns
 * null if there isn't enough of their own writing yet to say anything real.
 */
async function summarizeStyle(turns: Turn[]): Promise<string | null> {
  const theirs = turns.filter((t) => t.role === "user").slice(-15);
  if (theirs.length < 3) return null;

  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      instructions:
        "You are analyzing one person's text messages to a service, to help that service's agent adapt its tone. " +
        "In exactly one sentence, describe how this specific person writes and what kind of replies they seem to want " +
        "(e.g. terse vs. chatty, patient vs. wants speed, wants detail vs. just the bottom line). " +
        "Base it only on their actual wording and pacing - not on what they asked for. No preamble, just the sentence.",
      input: theirs.map((t) => `"${t.content}"`).join("\n"),
      max_output_tokens: 120,
    }),
  });
  if (!res.ok) throw new Error(`style summary HTTP ${res.status}`);
  const body = (await res.json()) as any;
  const text = (body.output ?? [])
    .flatMap((item: any) => item.content ?? [])
    .filter((c: any) => c.type === "output_text" || c.type === "text")
    .map((c: any) => c.text)
    .join(" ")
    .trim();
  return text || null;
}

/**
 * Learn from this person's own message history and persist the result.
 * Fire-and-forget from the caller's point of view - never throws, and does
 * nothing if there isn't enough signal yet.
 */
export async function learnStyle(phone: string, turns: Turn[]): Promise<void> {
  try {
    const summary = await summarizeStyle(turns);
    if (!summary) return;

    const [summaryVector, archetypes] = await Promise.all([
      embed(summary),
      loadArchetypeEmbeddings(),
    ]);
    let best = archetypes[0];
    let bestScore = -Infinity;
    for (const a of archetypes) {
      const score = cosine(summaryVector, a.vector);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }

    await fetch(`${config.voiceMcpUrl}/v1/style/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        summary,
        style_tag: best.tag,
        embedding: summaryVector,
      }),
    });
  } catch (err) {
    console.error(`learnStyle(${phone}) failed: ${(err as Error).message}`);
  }
}
