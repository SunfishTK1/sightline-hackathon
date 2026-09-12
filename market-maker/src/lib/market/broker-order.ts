import { estimateJobTravel } from "./campus-travel";
import { asNumber, money } from "./quote-price";
import { mapCategory } from "./map-category";
import type { BrokerOrderInput } from "./schemas";
import type { Task } from "./types";

export function requesterBudget(order: BrokerOrderInput): number {
  return asNumber(order.budget_usd) ?? 0;
}

export function requesterMaximum(order: BrokerOrderInput): number {
  return asNumber(order.maximum_usd) ?? requesterBudget(order);
}

export function taskFromBrokerOrder(
  order: BrokerOrderInput,
  pricing: { offerUsd: number; maximumUsd: number; autoUsd: number },
): Task {
  const now = new Date();
  const deadline = order.deadline_at ? new Date(order.deadline_at) : new Date(now.getTime() + 60 * 60_000);
  const category = mapCategory(order.category);
  const budget = requesterBudget(order);
  const travel = estimateJobTravel({
    pickup: order.pickup_location,
    dropoff: order.dropoff_location,
    category: order.category,
    deadlineAt: order.deadline_at,
    now,
  });
  return {
    taskId: order.id ?? `broker-${now.getTime()}`,
    requesterUuid: "broker-requester",
    rawText: order.details ?? order.title,
    structured: {
      title: order.title,
      description: order.details ?? order.title,
      category,
      pickupLocation: order.pickup_location ?? undefined,
      dropoffLocation: order.dropoff_location ?? undefined,
      deadline: Number.isNaN(deadline.getTime()) ? new Date(now.getTime() + 60 * 60_000) : deadline,
      estimatedMinutes: travel.totalMin,
      requirements: [],
    },
    pricing: {
      initialOfferUsd: budget || pricing.offerUsd,
      maximumUsd: money(pricing.maximumUsd),
      agentMayIncreaseToUsd: money(pricing.autoUsd),
      currentOfferUsd: money(pricing.offerUsd),
      currency: "USD",
    },
    relaxationPlan: [],
    ethics: { allowed: true, risk: "LOW", reasons: ["Broker quote"] },
    taskEmbedding: [],
    status: "MATCHING",
    createdAt: now,
    updatedAt: now,
  };
}
