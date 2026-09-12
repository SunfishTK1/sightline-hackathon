/**
 * @owner Will
 * Gemini text-embedding-004 → 768 dims. Falls back to zeros if the key is missing.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

export const EMBED_DIMS = 768;

function zeroVector(): number[] {
  return Array.from({ length: EMBED_DIMS }, () => 0);
}

export async function embedText(text: string): Promise<number[]> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return zeroVector();

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    const values = result.embedding?.values ?? [];
    if (values.length !== EMBED_DIMS) return zeroVector();
    return values;
  } catch {
    return zeroVector();
  }
}
