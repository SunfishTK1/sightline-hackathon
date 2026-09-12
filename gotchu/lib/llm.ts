/**
 * @owner Will
 * Shared JSON-mode LLM call + zod validate + safe fallback.
 */
import { z } from "zod";

export type LlmJsonOptions<T> = {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  fallback: T;
};

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function callLlmJson<T>({
  system,
  user,
  schema,
  fallback,
}: LlmJsonOptions<T>): Promise<T> {
  // TODO(Will): Anthropic / Gemini client with JSON-only request
  void system;
  void user;
  try {
    // Placeholder until keys + client are wired
    return fallback;
  } catch {
    return schema.parse(fallback);
  }
}

export { stripFences };
