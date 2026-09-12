import { config } from "./config.js";
import { CAMPUS_LOOK } from "./illustrate.js";

const VIDEO_URL = "https://api.openai.com/v1/videos";
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const VIDEO_MODEL = process.env.OPENAI_VIDEO_MODEL || "sora-2";
// Only multiples of four are accepted. Sixteen is the shortest length that
// fits a brief, three steps and a closing charge without rushing any of them.
const VIDEO_SECONDS = process.env.OPENAI_VIDEO_SECONDS || "16";
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

/** The film's script: what the job is, and how it actually gets done. */
export type MissionPlan = {
  objective: string; // one sentence, what the task is
  steps: string[]; // three imperatives, in order
};

const PLAN_INSTRUCTIONS = `You write mission briefs for a campus errand marketplace at Carnegie Mellon.

Given a task, return JSON:
{"objective": "one sentence stating the task plainly", "steps": ["step one", "step two", "step three"]}

Rules:
- objective: ONE sentence, under 18 words, concrete. What is being done, from where, to where. No adjectives, no hype.
- steps: exactly three, in order, each an imperative under 12 words describing a real physical action someone would take. These are genuine instructions - someone following them should actually complete the task.
- Use the real locations given. Do not invent a building.
- No numbering, no "first/then/finally" - just the action.
Return only JSON.`;

/**
 * Ask the model for the objective and the three steps. The film is only
 * motivating if the steps are real instructions, so they come from the task
 * rather than from a template.
 */
export async function planMission(order: FilmableOrder): Promise<MissionPlan> {
  const fallback: MissionPlan = {
    objective: order.title,
    steps: [
      order.pickup_location ? `Get to ${order.pickup_location}.` : "Get to the pickup point.",
      "Collect what was asked for and check it is right.",
      order.dropoff_location
        ? `Carry it to ${order.dropoff_location} and hand it over.`
        : "Deliver it and hand it over.",
    ],
  };

  try {
    const res = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        instructions: PLAN_INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: JSON.stringify({
              task: order.title,
              details: order.details,
              category: order.category,
              from: order.pickup_location,
              to: order.dropoff_location,
              pays_usd: order.budget_usd ? Number(order.budget_usd) : null,
            }),
          },
        ],
        max_output_tokens: 400,
      }),
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as any;
    const text = (body.output ?? [])
      .filter((o: any) => o.type === "message")
      .flatMap((o: any) => o.content ?? [])
      .filter((p: any) => p.type === "output_text" || p.type === "text")
      .map((p: any) => p.text)
      .join("")
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const parsed = JSON.parse(text) as Partial<MissionPlan>;
    const steps = (parsed.steps ?? []).filter((s) => typeof s === "string" && s.trim()).slice(0, 3);
    if (!parsed.objective || steps.length < 3) return fallback;
    return { objective: parsed.objective.trim(), steps };
  } catch {
    return fallback;
  }
}

/**
 * The pitch, not the record. This goes to people deciding whether to take the
 * job, so it is built like a briefing: here is the job, here is exactly how it
 * is done, and the last thing you see is that nobody has taken it yet.
 *
 * Sixteen seconds, three acts, timed so the instructions are genuinely
 * followable and the close actually asks for a decision.
 */
export function buildVideoPrompt(order: FilmableOrder, plan: MissionPlan): string {
  const [one, two, three] = plan.steps;
  const arrival = order.dropoff_location ?? "the drop-off";

  return [
    `A sixteen-second photorealistic cinematic mission briefing for a single campus errand: ${order.title}.`,
    CAMPUS_LOOK,
    "Show the students who use this campus as they actually are, varied and unremarkable.",

    // Act I - the brief.
    `SECONDS 0 TO 3, THE BRIEF: a slow push-in on the objective${
      order.pickup_location ? ` at ${order.pickup_location}` : ""
    }. A calm, low, clipped narrator states the task once, in exactly one sentence: "${plan.objective}". Nothing else is said.`,

    // Act II - the method. The part that has to be genuinely useful.
    `SECONDS 3 TO 12, THE METHOD: three clean shots, roughly three seconds each, showing exactly how the job gets done, in order. Shot one: ${one} Shot two: ${two} Shot three: ${three} Shoot each step as a precise practical action - hands, doors, the object itself, the route between - so someone watching could follow it. The narrator reads each step as it happens, one line per shot, nothing added.`,

    // Act III - the ask.
    `SECONDS 12 TO 16, THE CHARGE: pull back to a wide hero shot of ${arrival} with nobody there yet and the job still undone. The narrator delivers the close: "This mission is yours, should you choose to accept it." Hold on the empty frame and cut to black.`,

    // The joke is the treatment, not the task. Play it absolutely straight.
    "Shoot the whole thing like the cold open of a spy thriller: low hero angles, fast push-ins, one slow-motion beat, tight cuts, lens flare, shallow depth of field, handheld urgency.",
    "Score it with an epic Mission Impossible style orchestral track - driving staccato strings under the brief, urgent percussion building through the three steps, a rising brass sting landing exactly on the final line.",
    "Everyone plays it completely straight. Nobody winks at the camera, nobody laughs, there is no slapstick. The comedy is entirely in treating an ordinary errand as though the world depends on it.",

    "Photoreal, natural daylight, realistic textures and motion. Spoken narration only.",
    "No text, no captions, no subtitles, no logos, no watermarks, no on-screen graphics.",
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
): Promise<{ mp4: Buffer; prompt: string; seconds: string; plan: MissionPlan } | null> {
  const plan = await planMission(order);
  const prompt = buildVideoPrompt(order, plan);
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
        return { mp4, prompt, seconds: VIDEO_SECONDS, plan };
      }
      if (state.status === "failed") return null;
    }
    return null; // still going after ten minutes; let a later pass retry
  } catch {
    return null;
  }
}
