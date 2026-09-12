/**
 * @owner Will
 * Gemini text-embedding-004 → 768 dims.
 */
const EMBED_DIMS = 768;

export async function embedText(text: string): Promise<number[]> {
  // TODO(Will): Google Generative AI text-embedding-004
  void text;
  // Hardcoded fallback so demos never crash (spec ship rule)
  return Array.from({ length: EMBED_DIMS }, () => 0);
}

export { EMBED_DIMS };
