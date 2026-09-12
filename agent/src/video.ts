import { config } from "./config.js";
import { CAMPUS_LOOK } from "./illustrate.js";

const VIDEO_URL = "https://api.openai.com/v1/videos";
const VIDEO_MODEL = process.env.OPENAI_VIDEO_MODEL || "sora-2";
const VIDEO_SECONDS = process.env.OPENAI_VIDEO_SECONDS || "4";
const VIDEO_SIZE = process.env.OPENAI_VIDEO_SIZE || "720x1280";

/** Generation runs for minutes, so give it room but never hang forever. */
const POLL_INTERVAL_MS = 10_000;
const POLL_LIMIT = 60;

export type FilmableOrder = {
  id: string;
  title: string;
  details: string;
  category: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  budget_usd?: string | null;
  requester_phone: string;
};

/**
 * The pitch, not the record. This goes to people deciding whether to take the
 * job, so it shows the task being pulled off and handed over - the errand as
 * something worth doing, played entirely straight.
 */
export function buildVideoPrompt(order: FilmableOrder): string {
  const arrival = order.dropoff_location
    ? `arriving at ${order.dropoff_location} and handing it over`
    : "arriving and handing it over";

  return [
    `Photorealistic cinematic footage of a campus errand being pulled off: ${order.title}.`,
    `Context: ${order.details}`,
    `The person doing it moves with total purpose, ${arrival} to another student who takes it and nods.`,
    "Show the students who use this campus as they actually are, varied and unremarkable.",
    CAMPUS_LOOK,

    // The joke is the treatment, not the task. Play it absolutely straight.
    "Shoot it like the climax of a spy thriller: low hero angles, a fast push-in on the handover, a slow-motion beat as the object changes hands, tight cuts, lens flare, shallow depth of field.",
    "Score it with an epic Mission Impossible style orchestral track - driving staccato strings, urgent percussion, a rising brass sting exactly as the handoff lands.",
    "Everyone plays it completely straight. Nobody winks at the camera, nobody laughs, there is no slapstick. The comedy is entirely in treating an ordinary errand as though the world depends on it.",

    "Photoreal, natural daylight, realistic textures and motion.",
    "No text, no captions, no logos, no watermarks, no on-screen graphics.",
  ].join(" ");
}

type VideoJob = { id?: string; status?: string; progress?: number; error?: unknown };

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(VIDEO_URL + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Start a clip, wait for it, and return the bytes. Returns null on failure -
 * a missing video must never hold anything else up.
 */
export async function generateTaskVideo(
  order: FilmableOrder,
): Promise<{ mp4: Buffer; prompt: string; seconds: string } | null> {
  const prompt = buildVideoPrompt(order);
  try {
    const started = await api("", {
      method: "POST",
      body: JSON.stringify({
        model: VIDEO_MODEL,
        prompt,
        seconds: VIDEO_SECONDS,
        size: VIDEO_SIZE,
      }),
    });
    if (!started.ok) return null;
    const job = (await started.json()) as VideoJob;
    if (!job.id) return null;

    for (let i = 0; i < POLL_LIMIT; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const res = await api(`/${job.id}`);
      if (!res.ok) continue;
      const state = (await res.json()) as VideoJob;
      if (state.status === "completed") {
        const content = await api(`/${job.id}/content`);
        if (!content.ok) return null;
        const mp4 = Buffer.from(await content.arrayBuffer());
        return { mp4, prompt, seconds: VIDEO_SECONDS };
      }
      if (state.status === "failed") return null;
    }
    return null; // still going after ten minutes; let a later pass retry
  } catch {
    return null;
  }
}
