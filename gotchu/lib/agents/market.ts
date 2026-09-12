/**
 * @owner Divya
 * Market-making — findCandidates via Atlas Vector Search
 */
import type { Task } from "@/lib/types/task";
import type { Candidate } from "@/lib/types/match";
import { MOCK_CANDIDATES } from "@/mocks/candidates";

export async function findCandidates(task: Task): Promise<Candidate[]> {
  // TODO(Divya): $vectorSearch pipeline from §6b
  void task;
  return MOCK_CANDIDATES;
}
