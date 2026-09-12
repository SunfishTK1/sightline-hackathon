/**
 * Which model provider the live board generates pictures with.
 *
 * Deliberately a copy of the agent's `ai.ts` rather than a shared package:
 * these are two separately deployed services and a shared local import would
 * not survive the build. Keep the two in step - the switch has to mean the
 * same thing on both, or the board and the texts disagree about who drew what.
 *
 * Set AI_PROVIDER=openai or xai. Unset, whichever key is present wins,
 * preferring xAI.
 */

export type ProviderName = "openai" | "xai";

type ProviderSpec = {
  baseUrl: string;
  /** Accepted names for this provider's key, in order of preference. */
  keyVars: string[];
  /** Tried in order; the first that answers wins. */
  imageModels: string[];
  /**
   * Extra parameters, which genuinely differ: xAI answers 400
   * "Argument not supported: size", and OpenAI's image models reject
   * response_format. Verified against both live APIs.
   */
  imageParams: Record<string, unknown>;
};

const PROVIDERS: Record<ProviderName, ProviderSpec> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    keyVars: ["OPENAI_API_KEY"],
    imageModels: ["gpt-image-2.5-sunburst", "gpt-image-1", "dall-e-3"],
    imageParams: { size: "1024x1024", n: 1 },
  },
  xai: {
    baseUrl: "https://api.x.ai/v1",
    keyVars: ["XAI_API_KEY", "X_AI_API_KEY"],
    imageModels: ["grok-imagine-image-2.0", "grok-imagine-image"],
    imageParams: { n: 1, response_format: "b64_json" },
  },
};

function keyFor(name: ProviderName): string {
  for (const variable of PROVIDERS[name].keyVars) {
    const value = (process.env[variable] || "").trim();
    if (value) return value;
  }
  return "";
}

/** null when nothing is configured - callers skip generation rather than throw. */
export function aiProvider(): {
  name: ProviderName;
  key: string;
  imageUrl: string;
  imageModels: string[];
  imageParams: Record<string, unknown>;
} | null {
  const asked = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  let name: ProviderName | null = null;
  if (asked === "openai" || asked === "xai") {
    name = keyFor(asked) ? asked : null;
  } else if (keyFor("xai")) {
    name = "xai";
  } else if (keyFor("openai")) {
    name = "openai";
  }
  if (!name) return null;

  const spec = PROVIDERS[name];
  // OPENAI_IMAGE_MODEL names an OpenAI model, so it must not override the
  // model list on xAI - that pins a model the other provider does not have.
  const override =
    process.env.AI_IMAGE_MODEL || (name === "openai" ? process.env.OPENAI_IMAGE_MODEL : undefined);
  return {
    name,
    key: keyFor(name),
    imageUrl: `${(process.env.AI_BASE_URL || spec.baseUrl).replace(/\/$/, "")}/images/generations`,
    imageModels: [...new Set(override ? [override, ...spec.imageModels] : spec.imageModels)],
    imageParams: spec.imageParams,
  };
}
