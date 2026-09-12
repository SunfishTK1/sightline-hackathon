/**
 * Which model provider everything here talks to, and how to reach it.
 *
 * xAI mirrors OpenAI's API on every endpoint this project uses - the Responses
 * shape (`/v1/responses`, `input` + `instructions` + `output[]`), image
 * generation, and image editing with a reference photo - so switching is a base
 * URL, a key and a set of model names, not a second client. Verified against
 * the live xAI API rather than assumed.
 *
 * Two real differences:
 *
 *   - xAI publishes no embedding model, so `embeddingModel` is null there and
 *     anything embedding-based has to degrade instead of failing.
 *   - Video is gone on purpose (cost), and xAI has no video endpoint anyway.
 *
 * Set AI_PROVIDER=openai or AI_PROVIDER=xai. Unset, whichever key is present
 * wins, preferring xAI - so dropping a key in is enough to switch, and a
 * deploy with both keys keeps doing what the variable says.
 */

export type ProviderName = "openai" | "xai";

type ProviderSpec = {
  baseUrl: string;
  /** Accepted names for this provider's key, in order of preference. */
  keyVars: string[];
  chatModel: string;
  imageModel: string;
  /** null where the provider has no embedding model at all. */
  embeddingModel: string | null;
  /**
   * Extra parameters for image generation. These genuinely differ and both
   * providers reject what the other needs, so they are listed rather than
   * guessed: xAI answers 400 "Argument not supported: size", and OpenAI's
   * image models reject response_format.
   */
  imageParams: Record<string, unknown>;
  /**
   * How a reference photo is attached for an edit. OpenAI takes multipart with
   * an `image[]` file part; xAI takes JSON with `image: { url: <data URI> }`.
   * Verified against both live APIs.
   */
  referenceStyle: "multipart" | "json";
};

const PROVIDERS: Record<ProviderName, ProviderSpec> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    keyVars: ["OPENAI_API_KEY"],
    chatModel: "gpt-6-astra",
    imageModel: "gpt-image-2.5-sunburst",
    embeddingModel: "text-embedding-3-small",
    imageParams: { size: "1024x1024", n: 1 },
    referenceStyle: "multipart",
  },
  xai: {
    baseUrl: "https://api.x.ai/v1",
    keyVars: ["XAI_API_KEY", "X_AI_API_KEY"],
    chatModel: "grok-4.6",
    imageModel: "grok-imagine-image-2.0",
    embeddingModel: null,
    imageParams: { n: 1, response_format: "b64_json" },
    referenceStyle: "json",
  },
};

function keyFor(name: ProviderName): string {
  for (const variable of PROVIDERS[name].keyVars) {
    const value = (process.env[variable] || "").trim();
    if (value) return value;
  }
  return "";
}

function pickProvider(): ProviderName {
  const asked = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (asked === "openai" || asked === "xai") {
    if (!keyFor(asked)) {
      throw new Error(
        `AI_PROVIDER=${asked} but none of ${PROVIDERS[asked].keyVars.join(", ")} is set`,
      );
    }
    return asked;
  }
  if (asked) throw new Error(`AI_PROVIDER must be "openai" or "xai", not "${asked}"`);
  if (keyFor("xai")) return "xai";
  if (keyFor("openai")) return "openai";
  throw new Error("no model provider configured: set X_AI_API_KEY (or XAI_API_KEY) or OPENAI_API_KEY");
}

const provider = pickProvider();
const spec = PROVIDERS[provider];

/**
 * Model overrides. The legacy OPENAI_* names still pin an OpenAI deploy's
 * models — but only when OpenAI is the provider. They are the name of an
 * OpenAI model, and letting one through on xAI sends `gpt-6-astra` to
 * api.x.ai, which 404s on every reply. That is exactly what happened the
 * first time this was switched: the provider read `xai` and the chat model
 * still read `gpt-6-astra`.
 */
const legacy = (name: string): string | undefined =>
  provider === "openai" ? process.env[name] : undefined;

export const ai = {
  provider,
  baseUrl: (process.env.AI_BASE_URL || spec.baseUrl).replace(/\/$/, ""),
  key: keyFor(provider),
  chatModel: process.env.AI_CHAT_MODEL || legacy("OPENAI_AGENT_MODEL") || spec.chatModel,
  imageModel: process.env.AI_IMAGE_MODEL || legacy("OPENAI_IMAGE_MODEL") || spec.imageModel,
  embeddingModel: process.env.AI_EMBEDDING_MODEL || spec.embeddingModel,
  imageParams: spec.imageParams,
  referenceStyle: spec.referenceStyle,
};

export const responsesUrl = `${ai.baseUrl}/responses`;
export const embeddingsUrl = `${ai.baseUrl}/embeddings`;
export const imageUrl = `${ai.baseUrl}/images/generations`;
export const imageEditUrl = `${ai.baseUrl}/images/edits`;

/** Bearer header for JSON calls. Multipart callers must omit Content-Type. */
export function aiHeaders(extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${ai.key}`, ...extra };
}

export function aiJsonHeaders(): Record<string, string> {
  return aiHeaders({ "Content-Type": "application/json" });
}

/** Whether anything embedding-based can run at all under this provider. */
export function embeddingsAvailable(): boolean {
  return Boolean(ai.embeddingModel);
}

export function describeProvider(): string {
  return `${ai.provider} (chat ${ai.chatModel}, images ${ai.imageModel}, embeddings ${ai.embeddingModel ?? "none"})`;
}

type ImageResponse = { data?: Array<{ b64_json?: string; url?: string }> };

/**
 * Read the bytes out of an image response. One provider hands back base64 and
 * the other a short-lived URL, sometimes for the same request, so both are
 * handled rather than one being assumed.
 */
async function imageBytes(res: Response, label: string): Promise<Buffer | null> {
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    console.error(`${label} HTTP ${res.status}: ${detail}`);
    return null;
  }
  const body = (await res.json().catch(() => ({}))) as ImageResponse;
  const first = body.data?.[0];
  if (first?.b64_json) return Buffer.from(first.b64_json, "base64");
  if (first?.url) {
    const fetched = await fetch(first.url, { signal: AbortSignal.timeout(30_000) });
    if (fetched.ok) return Buffer.from(await fetched.arrayBuffer());
    console.error(`${label}: could not fetch the returned image URL`);
  }
  return null;
}

/** One picture from a prompt. Null on any failure - a task can go out without one. */
export async function createImage(prompt: string): Promise<Buffer | null> {
  try {
    const res = await fetch(imageUrl, {
      method: "POST",
      headers: aiJsonHeaders(),
      body: JSON.stringify({ model: ai.imageModel, prompt, ...ai.imageParams }),
      signal: AbortSignal.timeout(180_000),
    });
    return await imageBytes(res, "image");
  } catch (err) {
    console.error(`image failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * The same picture, conditioned on a photo of the person so it looks like
 * them. Null if the provider refuses the face, which is ordinary rather than
 * exceptional - the caller falls back to the plain picture.
 */
export async function createImageFromReference(
  prompt: string,
  reference: Buffer,
): Promise<Buffer | null> {
  try {
    let res: Response;
    if (ai.referenceStyle === "multipart") {
      const form = new FormData();
      form.append("model", ai.imageModel);
      form.append("prompt", prompt);
      for (const [key, value] of Object.entries(ai.imageParams)) {
        // response_format is a JSON-body parameter; the multipart edit endpoint
        // returns base64 regardless.
        if (key !== "response_format") form.append(key, String(value));
      }
      form.append(
        "image[]",
        new Blob([new Uint8Array(reference)], { type: "image/png" }),
        "reference.png",
      );
      // No Content-Type: fetch writes the multipart boundary itself.
      res = await fetch(imageEditUrl, { method: "POST", headers: aiHeaders(), body: form });
    } else {
      res = await fetch(imageEditUrl, {
        method: "POST",
        headers: aiJsonHeaders(),
        body: JSON.stringify({
          model: ai.imageModel,
          prompt,
          ...ai.imageParams,
          // Must be an object with `url` - a bare base64 string is rejected,
          // and a data URI in `url` is accepted.
          image: { url: `data:image/png;base64,${reference.toString("base64")}` },
        }),
        signal: AbortSignal.timeout(240_000),
      });
    }
    return await imageBytes(res, "likeness image");
  } catch (err) {
    console.error(`likeness image failed: ${(err as Error).message}`);
    return null;
  }
}
