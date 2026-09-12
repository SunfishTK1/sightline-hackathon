import type { EvaluateWorkerAction, Task, WorkerResponse } from "./types";

/**
 * Deterministic market policy. The LLM may parse SMS text into WorkerResponse;
 * it must not choose this action.
 */
export function evaluateWorkerResponse(
  task: Task,
  response: WorkerResponse,
): EvaluateWorkerAction {
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

  if (
    priceUsd <= task.pricing.agentMayIncreaseToUsd &&
    estimatedCompletionAt <= task.structured.deadline
  ) {
    return { action: "PROPOSE_FINAL_AGREEMENT" };
  }

  if (
    priceUsd <= task.pricing.maximumUsd &&
    estimatedCompletionAt <= task.structured.deadline
  ) {
    return {
      action: "ASK_REQUESTER",
      reason: "PRICE_OUTSIDE_AUTO_APPROVAL",
    };
  }

  return { action: "TRY_RELAXATION_OR_NEXT_CANDIDATE" };
}
