/**
 * @owner Daphne
 * Negotiation loop — runNegotiation (max 3 rounds / 6 LLM calls / 20s)
 */
import type { Task } from "@/lib/types/task";
import type { User } from "@/lib/types/user";
import type { Offer } from "@/lib/types/offer";
import { MOCK_NEGOTIATION_OFFER } from "@/mocks/negotiation";

export const MAX_ROUNDS = 3;
export const MAX_LLM_CALLS = 6;
export const MAX_WALL_MS = 20_000;

export async function runNegotiation(
  task: Task,
  worker: User,
): Promise<Offer> {
  // TODO(Daphne): bounded loop calling Thomas's nextMove; start with mockNextMove
  void task;
  void worker;
  return {
    ...MOCK_NEGOTIATION_OFFER,
    taskId: task.taskId,
    workerUuid: worker.uuid,
  };
}
