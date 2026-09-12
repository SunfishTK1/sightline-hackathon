import { config } from "./config.js";

const IMAGE_URL = "https://api.openai.com/v1/images/generations";
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";

export type IllustratableOrder = {
  id: string;
  title: string;
  details: string;
  category: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  budget_usd: string | null;
  requester_phone: string;
};

/**
 * Who appears in the picture. Left unsaid, the model draws the same young man
 * every time, which does not look like this campus. The person is chosen from
 * the task id, so one task always draws the same way while the set rotates
 * across tasks.
 */
const CAST = [
  "a Black woman student with locs",
  "an East Asian man student with glasses",
  "a South Asian woman student wearing a hijab",
  "a Latino man student with curly hair",
  "a white woman student with short red hair",
  "a Black man student with a fade and a backpack",
  "an East Asian woman student with a long ponytail",
  "a Middle Eastern man student with a trimmed beard",
  "a South Asian man student in a hoodie",
  "a white man student with a beanie",
  "a Latina woman student with braided hair",
  "a student using a wheelchair, moving confidently",
  "a Black woman student in athletic clothes",
  "an older student in their thirties, returning to study",
  "an East Asian man student with dyed blond hair",
  "a white woman student wearing glasses and a puffer jacket",
];

function castFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CAST[hash % CAST.length];
}

/**
 * A picture of the task itself, not a poster about it. Generated models garble
 * lettering, so the prompt asks for no text at all - the caption carries the
 * words, the image carries the thing.
 */
export function buildImagePrompt(order: IllustratableOrder): string {
  const route =
    order.pickup_location && order.dropoff_location
      ? `being carried from ${order.pickup_location} to ${order.dropoff_location} across a university campus`
      : order.dropoff_location
        ? `being delivered to ${order.dropoff_location} on a university campus`
        : "on a university campus";

  return [
    `A clean, friendly flat illustration showing this task: ${order.title}.`,
    `Details: ${order.details}`,
    `The person doing it is ${castFor(order.id)}.`,
    `Show the actual object or activity involved, ${route}.`,
    "Style: simple shapes, muted natural colours, soft daylight, collegiate brick and green quad setting.",
    "No text, no lettering, no numbers, no signage, no logos, no watermarks.",
    "One clear subject, uncluttered background.",
  ].join(" ");
}

/** Returns PNG bytes, or null if generation failed. Takes ~20 seconds. */
export async function generateTaskImage(
  order: IllustratableOrder,
): Promise<{ png: Buffer; prompt: string } | null> {
  const prompt = buildImagePrompt(order);
  try {
    const res = await fetch(IMAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: "1024x1024", n: 1 }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) return null;
    return { png: Buffer.from(b64, "base64"), prompt };
  } catch {
    return null;
  }
}
