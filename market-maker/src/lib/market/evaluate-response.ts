import { MAX_NEGOTIATION_ROUNDS } from "./constants";
import { looksLikeScopeChange } from "./scope-change";
import type { EvaluateWorkerAction, Task, WorkerResponse } from "./types";

/**
 * Deterministic market policy. The LLM may parse SMS text into WorkerResponse;
 * it must not choose this action.
 */
export function evaluateWorkerResponse(
  task: Task,
  response: WorkerResponse,
  options?: { roundsUsed?: number; counterNote?: string },
): EvaluateWorkerAction {
  if ((options?.roundsUsed ?? 0) >= MAX_NEGOTIATION_ROUNDS) {
    return { action: "TRY_NEXT_CANDIDATE" };
  }
  if (looksLikeScopeChange(options?.counterNote)) {
    return { action: "TRY_RELAXATION_OR_NEXT_CANDIDATE" };
  }

  if (response.decision === "DECLINE") {
    return { action: "TRY_NEXT_CANDIDATE" };
  }

  const priceUsd =
    response.priceUsd ??
    (response.decision === "ACCEPT" ? task.pricing.currentOfferUsd : undefined);
  const estimatedCompletionAt =
    response.estimatedCompletionAt ?? task.structured.deadline;

  if (priceUsd === undefined) {
    return { action: "TRY_RELAXATION_OR_NEXT_CANDIDATE" };
  }

  const onTime = estimatedCompletionAt <= task.structured.deadline;

  if (priceUsd <= task.pricing.agentMayIncreaseToUsd && onTime) {
    return { action: "PROPOSE_FINAL_AGREEMENT" };
  }

  if (priceUsd <= task.pricing.maximumUsd && !onTime) {
    return {
      action: "ASK_REQUESTER",
      reason: "TIME_OUTSIDE_DEADLINE",
    };
  }

  if (priceUsd <= task.pricing.maximumUsd && onTime) {
    return {
      action: "ASK_REQUESTER",
      reason: "PRICE_OUTSIDE_AUTO_APPROVAL",
    };
  }

  return { action: "TRY_RELAXATION_OR_NEXT_CANDIDATE" };
}
