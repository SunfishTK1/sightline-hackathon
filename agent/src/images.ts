import convert from "heic-convert";

/** What the model will accept directly. */
const MODEL_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export type PreparedImage = { dataUri: string } | { skipped: string };

/**
 * iPhone photos arrive as HEIC, which the model rejects. Astra converted with
 * macOS `sips`; this runs in a Linux container, so conversion is pure JS.
 */
export async function prepareImage(
  bytes: Buffer,
  mimeType: string,
  name: string,
): Promise<PreparedImage> {
  const mime = (mimeType || "").split(";")[0].trim().toLowerCase();

  if (!mime.startsWith("image/")) {
    return { skipped: `${name} (${mime || "unknown type"}, not an image)` };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { skipped: `${name} (too large at ${bytes.length} bytes)` };
  }

  if (MODEL_IMAGE_MIMES.has(mime)) {
    return { dataUri: `data:${mime};base64,${bytes.toString("base64")}` };
  }

  if (mime === "image/heic" || mime === "image/heif") {
    try {
      const jpeg = await convert({ buffer: bytes, format: "JPEG", quality: 0.85 });
      return { dataUri: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` };
    } catch (err) {
      return { skipped: `${name} (HEIC conversion failed: ${(err as Error).message})` };
    }
  }

  return { skipped: `${name} (${mime}, unsupported format)` };
}
