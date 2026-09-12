import { config } from "./config.js";
import { createImage, createImageFromReference } from "./ai.js";
import { likenessFor } from "./likeness.js";

// Which provider draws these, and the per-provider request shapes, live in
// ai.ts. This file is only about what to draw.

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
  // The picture is the only place a likeness appears now, and it holds one far
  // better than a clip ever did. How the reference is attached differs per
  // provider; that lives in ai.ts.
  const likeness = await likenessFor(order.requester_phone);
  if (likeness) {
    const prompt = `${buildImagePrompt(order)} The person doing the task is the student in the reference photo: keep their face, hair, and skin tone recognisably the same. Do not copy the reference's background or clothing - place them in the scene described above.`;
    const png = await createImageFromReference(prompt, likeness.png);
    if (png) {
      console.log(`drew "${order.title}" with the requester's likeness`);
      return { png, prompt };
    }
    // Refusing a real face is expected, not exceptional. Fall through to the
    // ordinary picture rather than leaving the task without one.
    console.error(`no likeness picture for "${order.title}" - drawing it plain`);
  }

  const prompt = buildImagePrompt(order);
  const png = await createImage(prompt);
  return png ? { png, prompt } : null;
}
