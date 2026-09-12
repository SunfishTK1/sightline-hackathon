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
/**
 * What Carnegie Mellon actually looks like. Without this the model draws a
 * generic red-brick campus with white columns and a clock tower, which is any
 * university except this one. CMU is Hornbostel's buff-brick Beaux-Arts around
 * a long open lawn, in hilly Pittsburgh.
 */
export const CAMPUS_LOOK = [
  "Setting: the Carnegie Mellon University campus in Pittsburgh.",
  "The buildings are warm buff and yellow-tan brick with pale stone trim, in a restrained Beaux-Arts style: rectangular blocks, tall repeated windows, heavy cornices, some with muted green tiled roofs.",
  "The open space is the Cut, a broad elongated lawn crossed by paved diagonal walks with mature trees along the edges - open and busy, not an enclosed medieval quadrangle.",
  "The terrain is hilly urban Pittsburgh, green and leafy, with the ground dropping away at the edges of campus.",
  "Do not draw red brick, white columns, a clock tower, Gothic spires, an enclosed stone quadrangle, or an Ivy League village. Those are other universities.",
].join(" ");

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
    `Show the actual object or activity involved, ${route}.`,
    "Show the students who use this campus as they actually are, varied and unremarkable.",
    CAMPUS_LOOK,
    "Style: clean flat illustration, simple shapes, muted natural colours, soft daylight.",
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
