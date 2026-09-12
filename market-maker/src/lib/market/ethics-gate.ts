/**
 * Daphne’s ethics agent, called over HTTP. Market-maker is the only caller.
 * Do not copy the deny-list — POST /api/ethics/review and /arbitrate.
 */
import { requesterBudget, requesterMaximum } from "./broker-order";
import { mapCategory } from "./map-category";
import type { BrokerOrderInput } from "./schemas";

export interface EthicsStructured {
  title: string;
  category: "pickup" | "food" | "moving" | "errand" | "tutoring_allowed" | "other";
  pickupLocation?: string;
  dropoffLocation?: string;
  deadline?: string;
  maxPriceUsd: number;
  estimatedMinutes?: number;
  requirements?: string[];
}

export interface BrokerEthicsVerdict {
  allowed: boolean;
  verdict: "ALLOW" | "ALLOW_WITH_CONDITIONS" | "BLOCK";
  reasons: string[];
}

export type ArbitrationLabel =
  | "ALLOW"
  | "STRIP_AMENDMENTS"
  | "REJECT_MOVE"
  | "BLOCK_TASK";

export interface BrokerArbitration {
  verdict: ArbitrationLabel;
  priceUsd: number;
  reason: string;
  stripAmendments: boolean;
}

const DEFAULT_ETHICS_URL = "http://127.0.0.1:3001";

export function ethicsBaseUrl(): string {
  return (process.env.ETHICS_BASE_URL ?? DEFAULT_ETHICS_URL).replace(/\/$/, "");
}

export function ethicsStructuredFromOrder(
  order: Pick<
    BrokerOrderInput,
    | "title"
    | "details"
    | "category"
    | "pickup_location"
    | "dropoff_location"
    | "deadline_at"
    | "budget_usd"
    | "maximum_usd"
  >,
): EthicsStructured {
  const blob = `${order.category ?? ""} ${order.title} ${order.details ?? ""}`;
  const mapped = mapCategory(blob);
  const category =
    mapped === "FOOD_RUN"
      ? "food"
      : mapped === "PACKAGE_PICKUP"
        ? "pickup"
        : mapped === "MOVING"
          ? "moving"
          : mapped === "CAMPUS_ERRAND"
            ? "errand"
            : mapped === "TUTORING"
              ? "tutoring_allowed"
              : "other";
  const maxPriceUsd = requesterMaximum(order) || requesterBudget(order) || 0;
  return {
    title: order.title,
    category,
    pickupLocation: order.pickup_location ?? undefined,
    dropoffLocation: order.dropoff_location ?? undefined,
    deadline: order.deadline_at ?? undefined,
    maxPriceUsd,
    requirements: order.details ? [order.details] : undefined,
  };
}

async function postEthics<T>(path: string, body: unknown): Promise<T | null> {
  const url = `${ethicsBaseUrl()}${path}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { ok?: boolean; data?: T };
    if (!payload.ok || payload.data == null) return null;
    return payload.data;
  } catch {
    return null;
  }
}

/** Gate a task before we rank or outreach. BLOCK → no picks. */
export async function reviewBrokerAction(input: {
  title?: string;
  details?: string;
  note?: string;
  category?: string | null;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  deadline_at?: string | null;
  budget_usd?: string | number | null;
  maximum_usd?: string | number | null;
}): Promise<BrokerEthicsVerdict> {
  const structured = ethicsStructuredFromOrder({
    title: input.title || "Untitled",
    details: [input.details, input.note].filter(Boolean).join("\n") || undefined,
    category: input.category,
    pickup_location: input.pickup_location,
    dropoff_location: input.dropoff_location,
    deadline_at: input.deadline_at,
    budget_usd: input.budget_usd,
    maximum_usd: input.maximum_usd,
  });
  const data = await postEthics<{
    verdict: BrokerEthicsVerdict["verdict"];
    reason?: string;
    conditions?: string[];
  }>("/api/ethics/review", { structured });

  if (!data) {
    return {
      allowed: true,
      verdict: "ALLOW_WITH_CONDITIONS",
      reasons: ["Ethics service unavailable — manual review recommended."],
    };
  }

  const reasons = [data.reason, ...(data.conditions ?? [])].filter(
    (line): line is string => Boolean(line),
  );
  return {
    allowed: data.verdict !== "BLOCK",
    verdict: data.verdict,
    reasons,
  };
}

/**
 * Referee one offer / counter before we save or tell the personal agent to text.
 * Once per evaluate turn — do not also call this from the personal agent.
 */
export async function arbitrateBrokerMove(input: {
  order: BrokerOrderInput;
  priceUsd: number;
  etaMinutes?: number;
  rationale?: string;
  accept: boolean;
  role: "worker_agent" | "requester_agent";
  amendments?: { path: string; to: unknown }[];
}): Promise<BrokerArbitration> {
  const structured = ethicsStructuredFromOrder(input.order);
  const data = await postEthics<{
    verdict: ArbitrationLabel;
    priceUsd?: number;
    reason?: string;
  }>("/api/ethics/arbitrate", {
    originalStructured: structured,
    currentStructured: structured,
    role: input.role,
    proposed: {
      priceUsd: input.priceUsd,
      etaMinutes: input.etaMinutes ?? 20,
      rationale: input.rationale ?? "",
      accept: input.accept,
      amendments: input.amendments ?? [],
    },
    transcript: [],
  });

  if (!data) {
    return {
      verdict: "ALLOW",
      priceUsd: input.priceUsd,
      reason: "Ethics service unavailable — price-only move allowed.",
      stripAmendments: false,
    };
  }

  return {
    verdict: data.verdict,
    priceUsd: data.priceUsd ?? input.priceUsd,
    reason: data.reason ?? "",
    stripAmendments: data.verdict === "STRIP_AMENDMENTS",
  };
}

export function arbitrationBlocksDeal(verdict: ArbitrationLabel): boolean {
  return verdict === "BLOCK_TASK" || verdict === "REJECT_MOVE";
}
