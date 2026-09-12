import { findUserByPhone, upsertUser } from "@/lib/db/users";
import { normalizePhone } from "@/lib/phone";
import { asNumber } from "./quote-price";
import { mapWorkerCategories } from "./map-category";
import type { BrokerCandidateInput } from "./schemas";
import type { User, UserStats } from "./types";

function digits(phone: string): string {
  return normalizePhone(phone).replace(/\D/g, "") || "unknown";
}

function mergeStats(base: UserStats, incoming?: BrokerCandidateInput["stats"]): UserStats {
  if (!incoming) return base;
  return {
    ...base,
    ratingCount: incoming.ratingCount ?? base.ratingCount,
    workerAvgRating: incoming.workerAvgRating ?? base.workerAvgRating,
    tasksCompletedAsWorker:
      incoming.tasksCompletedAsWorker ?? base.tasksCompletedAsWorker,
    completionRate: incoming.completionRate ?? base.completionRate,
  };
}

export async function upsertBrokerWorker(input: BrokerCandidateInput): Promise<User> {
  const phone = normalizePhone(input.phone);
  const existing = await findUserByPhone(phone);
  const now = new Date();
  const categories = mapWorkerCategories(input.categories);
  const minPriceUsd = asNumber(input.min_price_usd);
  const preferredPriceUsd = asNumber(input.preferred_price_usd);

  if (existing) {
    const next: User = {
      ...existing,
      preferenceText: input.blurb ?? existing.preferenceText,
      workerProfile: {
        ...existing.workerProfile,
        enabled: true,
        minPriceUsd: minPriceUsd ?? existing.workerProfile.minPriceUsd,
        preferredPriceUsd: preferredPriceUsd ?? existing.workerProfile.preferredPriceUsd,
        categories: categories.length ? categories : existing.workerProfile.categories,
      },
      availability: { isAvailable: true },
      stats: mergeStats(existing.stats, input.stats),
      updatedAt: now,
    };
    await upsertUser(next);
    return next;
  }

  const id = `user-phone-${digits(phone)}`;
  const created: User = {
    uuid: id,
    auth0Sub: `broker|${id}`,
    firstName: "Worker",
    lastName: digits(phone).slice(-4),
    cmuEmail: `broker.${digits(phone)}@gotchu.local`,
    phone,
    preferenceText: input.blurb ?? "",
    preferenceEmbedding: [],
    workerProfile: {
      enabled: true,
      categories,
      excludedCategories: [],
      typicalLocations: [],
      minPriceUsd,
      preferredPriceUsd,
      allowAgentAutoReject: false,
      allowAgentAutoAccept: false,
    },
    requesterProfile: {
      allowAutomaticCounters: true,
    },
    stats: mergeStats(
      {
        tasksRequested: 0,
        tasksCompletedAsWorker: 0,
        requesterAvgRating: null,
        workerAvgRating: null,
        ratingCount: 0,
        acceptanceRate: null,
        completionRate: null,
      },
      input.stats,
    ),
    availability: { isAvailable: true },
    createdAt: now,
    updatedAt: now,
  };
  await upsertUser(created);
  return created;
}
