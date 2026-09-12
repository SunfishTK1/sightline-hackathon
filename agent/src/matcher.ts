import { config } from "./config.js";
import { CAMPUS_GEOGRAPHY } from "./campus.js";

const OPENAI_URL = "https://api.openai.com/v1/responses";

export type OpenOrder = {
  id: string;
  title: string;
  details: string;
  category: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  deadline_at: string | null;
  budget_usd: string | null;
  urgency: string | null;
  requester_phone: string;
};

export type Candidate = {
  phone: string;
  blurb: string | null;
  categories: string[];
  min_price_usd: string | null;
};

export type Pick = { phone: string; reason: string };

const INSTRUCTIONS = [
  "You are the marketplace agent for a task service at Carnegie Mellon University.",
  CAMPUS_GEOGRAPHY,
  "Given one task and a list of people willing to pick up work, decide which of them are genuinely worth asking.",
  "Judge on fit: what they say they will do, how close they usually are to the pickup and dropoff, and whether the pay clears their minimum.",
  "Someone who has not named categories or a minimum is open to being asked about ordinary campus work - treat a general profile as a yes to reasonable tasks, not as a reason to skip them. A missing category is not a refusal: only an explicit 'I won't do X' is.",
  "Most campus tasks are ordinary: a single item one person can carry, a delivery, a pickup, an errand. Rule someone out only when the task genuinely exceeds what a willing student would do unasked - furniture needing two people or a vehicle, work far off campus, or a specialist skill they never claimed.",
  "Asking is cheap and they can simply say no. A task nobody is asked about never gets done, which is the worse failure.",
  "Pick at most 2. Pick none only when nobody is a plausible fit - an irrelevant ask trains people to ignore us, but never asking anyone means the task never gets done.",
  "Reply with JSON only: {\"picks\":[{\"phone\":\"+1...\",\"reason\":\"one short sentence, addressed to nobody, explaining the fit\"}]}",
].join(" ");

/** Ask the model who is worth soliciting. Falls back to no picks on failure. */
export async function pickWorkers(order: OpenOrder, candidates: Candidate[]): Promise<Pick[]> {
  if (!candidates.length) return [];

  const summary = {
    task: {
      title: order.title,
      details: order.details,
      category: order.category,
      from: order.pickup_location,
      to: order.dropoff_location,
      pays_usd: order.budget_usd ? Number(order.budget_usd) : null,
      due: order.deadline_at,
      urgency: order.urgency,
    },
    people: candidates.map((c) => ({
      phone: c.phone,
      about: c.blurb,
      categories: c.categories,
      minimum_usd: c.min_price_usd ? Number(c.min_price_usd) : null,
    })),
  };

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        instructions: INSTRUCTIONS,
        input: [{ role: "user", content: JSON.stringify(summary) }],
        max_output_tokens: 700,
      }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as any;

    const text = (body.output ?? [])
      .filter((o: any) => o.type === "message")
      .flatMap((o: any) => o.content ?? [])
      .filter((p: any) => p.type === "output_text" || p.type === "text")
      .map((p: any) => p.text)
      .join("")
      .trim();

    const json = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json) as { picks?: Pick[] };
    const known = new Set(candidates.map((c) => c.phone));
    return (parsed.picks ?? [])
      .filter((p) => p?.phone && known.has(p.phone)) // never invent a number
      .slice(0, 2);
  } catch {
    return [];
  }
}
