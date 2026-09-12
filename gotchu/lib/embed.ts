/**
 * @owner Will
 * Gemini text-embedding-004 → 768 dims. Returns null on failure so callers
 * keep the previous vector instead of storing a pile of zeros that would
 * collapse matching scores for everyone who hit a missing key / API error.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

export const EMBED_DIMS = 768;

export function isUsableEmbedding(values: number[] | null | undefined): values is number[] {
  return Boolean(values && values.length === EMBED_DIMS && values.some((n) => n !== 0));
}

export async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    const values = result.embedding?.values ?? [];
    return isUsableEmbedding(values) ? values : null;
  } catch {
    return null;
  }
}
