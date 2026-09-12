/**
 * Putting the person who asked for a task into the film made about it.
 *
 * Two things gate this, and both are hard gates rather than preferences:
 * they must have ticked the likeness consent at signup, and they must have
 * uploaded a photo. Absent either, generation falls back to the generic look -
 * which is also what happens when the model refuses, so the fallback is a path
 * that runs regularly rather than a branch nobody exercises.
 *
 * What this produces is a still the video model conditions its first frame on.
 * It is not a promise the person will be recognisable, and the clip is a
 * dramatisation of a task nobody has done yet - which is exactly why it is
 * opt-in.
 */
import sharp from "sharp";
import { market } from "./mcp.js";

/** Sora rejects a reference whose dimensions differ from the requested size. */
const REFERENCE_WIDTH = 720;
const REFERENCE_HEIGHT = 1280;

export type Likeness = { png: Buffer } | null;

function decodeDataUrl(dataUrl: string): { bytes: Buffer; mime: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
}

/**
 * Fetch the person's photo, if they have one and agreed to it, and fit it to
 * the exact frame the video model wants. Returns null for every failure: a
 * missing likeness must never stop a film being made.
 */
export async function likenessFor(phone: string | null | undefined): Promise<Likeness> {
  if (!phone) return null;
  try {
    const info = await market.likeness(phone);
    if (!info?.consented || !info.avatar_data_url) return null;

    const decoded = decodeDataUrl(info.avatar_data_url);
    if (!decoded) return null;

    // Cover rather than contain: letterbox bars would be baked into the
    // opening frame of the clip.
    const png = await sharp(decoded.bytes)
      .resize(REFERENCE_WIDTH, REFERENCE_HEIGHT, { fit: "cover", position: "attention" })
      .png()
      .toBuffer();

    return { png };
  } catch {
    return null;
  }
}
