/**
 * @owner Thomas
 * Personal AI agent — parseTask + nextMove
 */
import type { StructuredTask } from "@/lib/types/task";
import type { User } from "@/lib/types/user";
import type { NegotiationMessage, NegotiationRole } from "@/lib/types/offer";
import type { Task } from "@/lib/types/task";
import { MOCK_STRUCTURED_TASK } from "@/mocks/task";

export async function parseTask(
  rawText: string,
  _user: User,
): Promise<StructuredTask> {
  // TODO(Thomas): LLM intake per §6a; fallback to mock
  void rawText;
  return { ...MOCK_STRUCTURED_TASK };
}

export type NextMoveArgs = {
  task: Task;
  principalPreferenceText: string;
  role: NegotiationRole;
  transcript: NegotiationMessage[];
  reservationPrice: number;
};

export async function nextMove(args: NextMoveArgs): Promise<NegotiationMessage> {
  // TODO(Thomas): negotiate brain; Daphne calls this inside her loop
  void args;
  return {
    round: 1,
    from: args.role,
    priceUsd: args.reservationPrice,
    etaMinutes: 20,
    rationale: "Fallback move — wire personal-negotiate prompt.",
    accept: false,
    at: new Date().toISOString(),
  };
}
