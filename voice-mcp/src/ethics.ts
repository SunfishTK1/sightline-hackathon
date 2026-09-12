/**
 * The ethics gate. The model lives in Daphne's `gotchu/lib/agents/ethics.ts`
 * and is reached over HTTP - the deny-list and rubric are hers, and must not be
 * copied or re-implemented here.
 *
 * A task must pass this before it can go looking for someone.
 */
const ETHICS_BASE_URL = (process.env.ETHICS_BASE_URL || "").replace(/\/$/, "");

export type EthicsVerdict = {
  verdict: "ALLOW" | "ALLOW_WITH_CONDITIONS" | "BLOCK";
  reason?: string;
  categories?: string[];
  conditions?: string[];
};

export type AmendmentVerdict = {
  verdict: "ALLOW" | "REJECT";
  sameTask?: boolean;
  reason?: string;
};

/** What a task looks like to the gate. */
export function structuredFrom(order: {
  title: string;
  details: string;
  category?: string | null;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  budget_usd?: number | string | null;
  deadline_at?: string | null;
}) {
  const details = order.details?.trim() || "";
  const maxPriceUsd =
    order.budget_usd != null && Number.isFinite(Number(order.budget_usd))
      ? Number(order.budget_usd)
      : 0;
  return {
    title: order.title,
    description: details,
    category: order.category ?? "other",
    pickupLocation: order.pickup_location ?? undefined,
    dropoffLocation: order.dropoff_location ?? undefined,
    maxPriceUsd,
    deadline: order.deadline_at ?? undefined,
    // Gotchu's StructuredTask has no `description` field. Put the details
    // here so the same-job check still sees what the person said.
    requirements: details ? [details] : undefined,
  };
}

async function ask<T>(path: string, body: unknown): Promise<T | null> {
  if (!ETHICS_BASE_URL) return null; // not configured; caller decides
  try {
    const res = await fetch(`${ETHICS_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const parsed = (await res.json()) as { ok?: boolean; data?: T };
    return parsed.ok === false ? null : (parsed.data ?? null);
  } catch {
    return null;
  }
}

/**
 * Gate a task before it opens. Returns null when the gate is unreachable -
 * the caller must decide, and for a marketplace that means holding the task
 * rather than quietly opening it.
 */
export async function reviewTask(order: Parameters<typeof structuredFrom>[0]) {
  return ask<EthicsVerdict>("/api/ethics/review", { structured: structuredFrom(order) });
}

/** Is the edited task still the same job? Price and deadline edits are exempt. */
export async function reviewAmendment(
  original: Parameters<typeof structuredFrom>[0],
  proposed: Parameters<typeof structuredFrom>[0],
) {
  const originalStructured = structuredFrom(original);
  const proposedStructured = structuredFrom(proposed);
  return ask<AmendmentVerdict>("/api/ethics/amendment", {
    originalStructured,
    proposedStructured,
    original: originalStructured,
    proposed: proposedStructured,
  });
}

export const ethicsConfigured = () => Boolean(ETHICS_BASE_URL);
