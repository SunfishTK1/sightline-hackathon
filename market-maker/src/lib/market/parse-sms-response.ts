import type { ParsedRequesterChoice, ParsedWorkerSms } from "./schemas";

export async function parseWorkerSms(rawText: string): Promise<ParsedWorkerSms> {
  const text = rawText.trim();
  const upper = text.toUpperCase();

  if (/^(YES|Y|ACCEPT|APPROVE)\b/.test(upper)) {
    return { decision: "ACCEPT", rawText: text, confidence: 0.98 };
  }
  if (/^(NO|N|DECLINE)\b/.test(upper)) {
    return { decision: "DECLINE", rawText: text, confidence: 0.98 };
  }

  const minutesMatch = text.match(/(\d+)\s*(?:min|mins|minutes)\b/i);
  const priceMatch = text.match(
    /(?:counter\s*)?\$\s*(\d+(?:\.\d{1,2})?)|(?:counter\s+)(\d+(?:\.\d{1,2})?)/i,
  );
  if (/counter/i.test(text) || priceMatch) {
    const priceUsd = priceMatch
      ? Number(priceMatch[1] ?? priceMatch[2])
      : undefined;
    const minutes = minutesMatch ? Number(minutesMatch[1]) : undefined;
    return {
      decision: "COUNTER",
      priceUsd,
      estimatedCompletionAt: minutes
        ? new Date(Date.now() + minutes * 60_000)
        : undefined,
      rawText: text,
      confidence: priceUsd != null ? 0.92 : 0.6,
    };
  }

  return { decision: "DECLINE", rawText: text, confidence: 0.4 };
}

export async function parseRequesterSms(
  rawText: string,
): Promise<ParsedRequesterChoice> {
  const text = rawText.trim().toUpperCase();
  if (text === "1" || text === "2" || text === "NO" || text === "APPROVE" || text === "REJECT") {
    return { choice: text as ParsedRequesterChoice["choice"], confidence: 0.99 };
  }
  return { choice: "NO", confidence: 0.3 };
}
