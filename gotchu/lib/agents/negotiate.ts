/**
 * @owner Daphne
 * Leftover web negotiate stub. The live loop is Divya's (`agent/` / market-maker).
 * Daphne referees that loop via `arbitrateMove` / `POST /api/ethics/arbitrate`.
 */
import type { Task } from "@/lib/types/task";
import type { User } from "@/lib/types/user";
import type { NegotiationMessage, Offer, OfferOutcome } from "@/lib/types/offer";
import { MOCK_NEGOTIATION_OFFER } from "@/mocks/negotiation";

export const MAX_ROUNDS = 3;
export const MAX_LLM_CALLS = 6;
export const MAX_WALL_MS = 20_000;

/** A deal is agreed only when both sides accept the same price. */
export function outcomeFromTranscript(
  transcript: NegotiationMessage[],
): { outcome: OfferOutcome; finalPriceUsd?: number } {
  const lastWorker = [...transcript].reverse().find((m) => m.from === "worker_agent");
  const lastRequester = [...transcript].reverse().find((m) => m.from === "requester_agent");
  if (
    lastWorker?.accept &&
    lastRequester?.accept &&
    lastWorker.priceUsd === lastRequester.priceUsd
  ) {
    return { outcome: "AGREED", finalPriceUsd: lastWorker.priceUsd };
  }
  return { outcome: "PENDING" };
}

export async function runNegotiation(
  task: Task,
  worker: User,
): Promise<Offer> {
  // TODO(leftover): web stub only; live loop is agent/ (Divya)
  void worker;
  const transcript = MOCK_NEGOTIATION_OFFER.transcript;
  const settled = outcomeFromTranscript(transcript);
  return {
    ...MOCK_NEGOTIATION_OFFER,
    taskId: task.taskId,
    workerUuid: worker.uuid,
    outcome: settled.outcome,
    finalPriceUsd: settled.finalPriceUsd,
  };
}
