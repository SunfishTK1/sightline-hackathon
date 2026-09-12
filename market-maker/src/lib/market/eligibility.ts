import type {
  EligibilityReason,
  EligibilityResult,
  Task,
  User,
} from "./types";

export function evaluateEligibility(
  task: Task,
  user: User,
  options?: { contactedWorkerUuids?: Set<string>; busyWorkerUuids?: Set<string> },
): EligibilityResult {
  const reasons: EligibilityReason[] = [];

  if (user.uuid === task.requesterUuid) {
    reasons.push("IS_REQUESTER");
  }
  if (!user.workerProfile.enabled) {
    reasons.push("WORKER_DISABLED");
  }
  if (!user.availability.isAvailable) {
    reasons.push("UNAVAILABLE");
  }
  if (user.workerProfile.excludedCategories.includes(task.structured.category)) {
    reasons.push("CATEGORY_EXCLUDED");
  }
  if (
    user.workerProfile.categories.length > 0 &&
    !user.workerProfile.categories.includes(task.structured.category)
  ) {
    reasons.push("CATEGORY_NOT_OFFERED");
  }

  const authorizedPrice = task.pricing.agentMayIncreaseToUsd;
  if (
    user.workerProfile.minPriceUsd != null &&
    user.workerProfile.minPriceUsd > authorizedPrice
  ) {
    reasons.push("MIN_PRICE_ABOVE_AUTHORIZED");
  }

  if (options?.contactedWorkerUuids?.has(user.uuid)) {
    reasons.push("ALREADY_CONTACTED_THIS_RUN");
  }
  if (options?.busyWorkerUuids?.has(user.uuid)) {
    reasons.push("HAS_UNRESOLVED_TASK");
  }

  return { eligible: reasons.length === 0, reasons };
}
