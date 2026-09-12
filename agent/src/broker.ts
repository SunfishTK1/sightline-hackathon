import { config } from "./config.js";
import type { Candidate, OpenOrder } from "./matcher.js";

export type BrokerTravel = {
  from: string;
  to: string;
  known: boolean;
  distanceM: number;
  distanceMi: number;
  walkMin: number;
  driveMin: number;
  busMin: number;
  recommended: string;
  line: string;
  workMin: number;
  totalMin: number;
  slackMin: number | null;
  feasibility: "OK" | "TIGHT" | "INFEASIBLE";
  suggestedDeadline: string | null;
};

export type BrokerPick = {
  phone: string;
  reason: string;
  offerUsd: number;
  score: number;
  pDeal?: number;
  pWorker?: number;
  pRequester?: number;
  askTime?: boolean;
};

export type BrokerQuote = {
  suggestedOfferUsd: number;
  maximumUsd: number;
  travel?: BrokerTravel;
  picks: BrokerPick[];
  skip: { phone: string; reason: string }[];
};

export type BrokerEvaluate = {
  action: "ACCEPT" | "COUNTER" | "ASK_REQUESTER" | "TRY_NEXT" | "REJECT_SCOPE";
  agreedUsd?: number;
  nextOfferUsd?: number;
  messageHint: string;
  askRequester: boolean;
  suggestedDeadline?: string;
  neededMinutes?: number;
};

function orderPayload(order: OpenOrder) {
  return {
    id: order.id,
    title: order.title,
    details: order.details,
    category: order.category,
    pickup_location: order.pickup_location,
    dropoff_location: order.dropoff_location,
    deadline_at: order.deadline_at,
    budget_usd: order.budget_usd,
    urgency: order.urgency,
    requester_phone: order.requester_phone,
  };
}

export async function quoteOrder(
  order: OpenOrder,
  candidates: Candidate[],
): Promise<BrokerQuote | null> {
  try {
    const res = await fetch(`${config.marketMakerUrl}/api/broker/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: orderPayload(order),
        candidates: candidates.map((candidate) => ({
          phone: candidate.phone,
          blurb: candidate.blurb,
          categories: candidate.categories,
          min_price_usd: candidate.min_price_usd,
        })),
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as BrokerQuote;
  } catch {
    return null;
  }
}

export async function evaluateDeal(input: {
  order: {
    title: string;
    details?: string | null;
    category?: string | null;
    budget_usd?: string | number | null;
    deadline_at?: string | null;
    pickup_location?: string | null;
    dropoff_location?: string | null;
  };
  current_offer_usd: number;
  decision:
    | "ACCEPT"
    | "DECLINE"
    | "COUNTER"
    | "REQUESTER_YES"
    | "REQUESTER_NO"
    | "AUTO_WORKER"
    | "AUTO_REQUESTER"
    | "TIMEOUT"
    | "NEED_TIME";
  price_usd?: number;
  worker_min_usd?: number;
  note?: string;
  round?: number;
  estimated_minutes?: number;
}): Promise<BrokerEvaluate | null> {
  try {
    const res = await fetch(`${config.marketMakerUrl}/api/broker/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    return (await res.json()) as BrokerEvaluate;
  } catch {
    return null;
  }
}
