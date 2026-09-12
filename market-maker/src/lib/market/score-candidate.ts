import { NEW_USER_RELIABILITY, RELIABILITY_MIN_RATINGS } from "./constants";
import { semanticFit } from "./semantic";
import type { CandidateScores, Task, User } from "./types";

export function reliabilityScore(user: User): number {
  if (
    user.stats.ratingCount >= RELIABILITY_MIN_RATINGS &&
    user.stats.workerAvgRating != null
  ) {
    return user.stats.workerAvgRating / 5;
  }
  return NEW_USER_RELIABILITY;
}

export function combineScores(
  parts: Omit<CandidateScores, "final">,
): CandidateScores {
  const final =
    0.4 * parts.vector +
    0.2 * parts.availability +
    0.15 * parts.priceFit +
    0.1 * parts.reliability +
    0.1 * parts.experience +
    0.05 * parts.location;

  return { ...parts, final };
}

export function priceFit(task: Task, user: User): number {
  const offer = task.pricing.currentOfferUsd;
  const min = user.workerProfile.minPriceUsd ?? 0;
  const preferred = user.workerProfile.preferredPriceUsd ?? offer;
  if (offer < min) return 0;
  if (offer >= preferred) return 1;
  return (offer - min) / Math.max(preferred - min, 1);
}

export function availabilityFit(task: Task, user: User): number {
  if (!user.availability.isAvailable) return 0;

  const text = (user.workerProfile.availabilityText ?? "").toLowerCase();
  const deadlineHour = task.structured.deadline.getHours();
  const afterMatch = text.match(/after\s+(\d{1,2})\s*(am|pm)?/);
  if (afterMatch) {
    let hour = Number(afterMatch[1]);
    const meridiem = afterMatch[2];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (deadlineHour < hour) return 0.25;
  }

  const untilMatch = text.match(/until\s+(\d{1,2})\s*(am|pm)?/);
  if (untilMatch) {
    let hour = Number(untilMatch[1]);
    const meridiem = untilMatch[2];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (deadlineHour > hour) return 0.3;
  }

  return 0.85;
}

export function experienceFit(task: Task, user: User): number {
  const doesCategory = user.workerProfile.categories.includes(
    task.structured.category,
  );
  const volume = Math.min(user.stats.tasksCompletedAsWorker / 10, 1);
  const completion = user.stats.completionRate ?? 0.7;
  if (!doesCategory) return 0.2 * volume;
  return 0.45 + 0.35 * volume + 0.2 * completion;
}

export function locationFit(task: Task, user: User): number {
  const targets = [
    task.structured.pickupLocation,
    task.structured.dropoffLocation,
    task.structured.meetingLocation,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizePlace);

  if (targets.length === 0) return 0.5;

  const typical = user.workerProfile.typicalLocations.map(normalizePlace);
  if (typical.includes("campus")) return 0.5;

  const hits = targets.filter((target) =>
    typical.some(
      (place) => place === target || place.includes(target) || target.includes(place),
    ),
  ).length;
  return hits / targets.length;
}

export function scoreCandidate(task: Task, user: User): CandidateScores {
  return combineScores({
    vector: semanticFit(task, user),
    priceFit: priceFit(task, user),
    availability: availabilityFit(task, user),
    reliability: reliabilityScore(user),
    experience: experienceFit(task, user),
    location: locationFit(task, user),
  });
}

export function explainScore(task: Task, user: User, scores: CandidateScores): string[] {
  const reasons: string[] = [];
  if (user.workerProfile.categories.includes(task.structured.category)) {
    reasons.push(`Offers ${task.structured.category.toLowerCase().replaceAll("_", " ")}`);
  }
  if (scores.location >= 0.5) {
    reasons.push(
      `Usually around ${user.workerProfile.typicalLocations.slice(0, 3).join(", ")}`,
    );
  }
  if (scores.priceFit >= 0.7) {
    reasons.push(`Price fit for $${task.pricing.currentOfferUsd}`);
  } else if (user.workerProfile.preferredPriceUsd) {
    reasons.push(`Prefers closer to $${user.workerProfile.preferredPriceUsd}`);
  }
  if (user.stats.ratingCount >= 3 && user.stats.workerAvgRating != null) {
    reasons.push(
      `${user.stats.workerAvgRating.toFixed(1)}/5 from ${user.stats.ratingCount} ratings`,
    );
  } else {
    reasons.push("New or lightly rated — using a neutral reliability prior");
  }
  if (scores.availability < 0.5) {
    reasons.push(
      user.workerProfile.availabilityText ??
        "Availability may miss the current deadline",
    );
  }
  return reasons;
}

function normalizePlace(value: string): string {
  return value.trim().toLowerCase();
}
