import { config } from "./config.js";
import { CAMPUS_LOOK } from "./illustrate.js";
import { likenessFor } from "./likeness.js";

const VIDEO_URL = "https://api.openai.com/v1/videos";
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const VIDEO_MODEL = process.env.OPENAI_VIDEO_MODEL || "sora-2";
// The API accepts 4, 8, 12, 16 and 20, and rejects everything else - twenty is
// the ceiling however long the content wants to be. Sixteen fits a brief,
// three steps and a closing charge; twenty buys room for a fourth step.
const SHORT_SECONDS = process.env.OPENAI_VIDEO_SECONDS || "16";
const LONG_SECONDS = process.env.OPENAI_VIDEO_SECONDS_LONG || "20";
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
  steps: string[]; // three or four imperatives, in order
};

/** Length follows the content: a fourth step needs the extra four seconds. */
export function secondsFor(plan: MissionPlan): string {
  return plan.steps.length > 3 ? LONG_SECONDS : SHORT_SECONDS;
}

const PLAN_INSTRUCTIONS = `You write mission briefs for a campus errand marketplace at Carnegie Mellon.

Given a task, return JSON:
{"objective": "one sentence stating the task plainly", "steps": ["step one", "step two", "step three"]}

Rules:
- objective: ONE sentence, under 18 words, concrete. What is being done, from where, to where. No adjectives, no hype.
- steps: three, or four when the job genuinely has a fourth distinct action - never pad to four. In order, each an imperative under 12 words describing a real physical action someone would take. These are genuine instructions - someone following them should actually complete the task.
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
    const steps = (parsed.steps ?? []).filter((s) => typeof s === "string" && s.trim()).slice(0, 4);
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
 * Three acts, timed so the instructions are genuinely followable and the close
 * actually asks for a decision. The length follows the number of steps.
 */
export function buildVideoPrompt(
  order: FilmableOrder,
  plan: MissionPlan,
  withLikeness = false,
): string {
  const arrival = order.dropoff_location ?? "the drop-off";

  // Three acts, sized to the clip: a three second brief, a four second close,
  // and everything between split evenly across however many steps there are.
  const total = Number(secondsFor(plan));
  const briefEnds = 3;
  const chargeStarts = total - 4;
  const perStep = (chargeStarts - briefEnds) / plan.steps.length;
  const shots = plan.steps
    .map((step, i) => {
      const from = Math.round(briefEnds + i * perStep);
      const to = Math.round(briefEnds + (i + 1) * perStep);
      return `${from}-${to}s: ${step}`;
    })
    .join(" ");

  return [
    `A ${total}-second photorealistic cinematic mission briefing for a single campus errand: ${order.title}.`,
    CAMPUS_LOOK,
    withLikeness
      ? "The person carrying out the task is the student in the reference image - keep their appearance consistent throughout. Everyone else on campus is varied and unremarkable."
      : "Show the students who use this campus as they actually are, varied and unremarkable.",

    // Act I - the brief.
    `SECONDS 0 TO ${briefEnds}, THE BRIEF: a slow push-in on the objective${
      order.pickup_location ? ` at ${order.pickup_location}` : ""
    }. A calm, low, clipped narrator states the task once, in exactly one sentence: "${plan.objective}". Nothing else is said.`,

    // Act II - the method. The part that has to be genuinely useful.
    `SECONDS ${briefEnds} TO ${chargeStarts}, THE METHOD: ${plan.steps.length} clean shots showing exactly how the job gets done, in order, one per step: ${shots} Shoot each step as a precise practical action - hands, doors, the object itself, the route between - so someone watching could follow it. The narrator reads each step as it happens, one line per shot, nothing added.`,

    // Act III - the ask.
    `SECONDS ${chargeStarts} TO ${total}, THE CHARGE: pull back to a wide hero shot of ${arrival} with nobody there yet and the job still undone. The narrator delivers the close: "This mission is yours, should you choose to accept it." Hold on the empty frame and cut to black.`,

    // The joke is the treatment, not the task. Play it absolutely straight.
    "Shoot the whole thing like the cold open of a spy thriller: low hero angles, fast push-ins, one slow-motion beat, tight cuts, lens flare, shallow depth of field, handheld urgency.",
    "Score it with an epic Mission Impossible style orchestral track - driving staccato strings under the brief, urgent percussion building through the steps, a rising brass sting landing exactly on the final line.",
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
      // Only for JSON bodies: setting it on FormData would clobber the
      // multipart boundary and the upload would be rejected.
      ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
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
  const seconds = secondsFor(plan);

  // Only when they asked to be in it. The prompt changes too: conditioning the
  // first frame on someone's face while the text still says "show students as
  // they actually are" pulls the model in two directions.
  const likeness = await likenessFor(order.requester_phone);
  const prompt = buildVideoPrompt(order, plan, Boolean(likeness));
  // Logged either way: without this there was no way to tell whether a film
  // had used someone's photo short of reading the stored prompt.
  console.log(
    likeness
      ? `filming "${order.title}" with the requester's likeness`
      : `filming "${order.title}" without a likeness (no consent, no photo, or no phone)`,
  );

  try {
    let started: Response;
    if (likeness) {
      // A reference has to be uploaded, and Sora rejects one whose dimensions
      // differ from the requested size - hence the exact 720x1280 fit.
      const form = new FormData();
      form.append("model", VIDEO_MODEL);
      form.append("prompt", prompt);
      form.append("seconds", seconds);
      form.append("size", VIDEO_SIZE);
      form.append(
        "input_reference",
        new Blob([new Uint8Array(likeness.png)], { type: "image/png" }),
        "reference.png",
      );
      started = await api("", { method: "POST", body: form });
      if (!started.ok) {
        // Refusing a real face is an expected outcome, not a bug. Fall back to
        // the generic film rather than leaving the task without one.
        console.error(
          `likeness film refused (HTTP ${started.status}) for "${order.title}" - falling back`,
        );
        started = await api("", {
          method: "POST",
          body: JSON.stringify({
            model: VIDEO_MODEL,
            prompt: buildVideoPrompt(order, plan, false),
            seconds,
            size: VIDEO_SIZE,
          }),
        });
      }
    } else {
      started = await api("", {
        method: "POST",
        body: JSON.stringify({
          model: VIDEO_MODEL,
          prompt,
          seconds,
          size: VIDEO_SIZE,
        }),
      });
    }
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
        return { mp4, prompt, seconds, plan };
      }
      if (state.status === "failed") return null;
    }
    return null; // still going after ten minutes; let a later pass retry
  } catch {
    return null;
  }
}
