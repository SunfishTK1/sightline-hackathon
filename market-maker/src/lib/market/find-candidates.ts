import { listBusyWorkerUuids, findTaskById } from "@/lib/db/tasks";
import { listEnabledWorkers } from "@/lib/db/users";
import type { FindCandidates } from "./contracts";
import { evaluateEligibility } from "./eligibility";
import { explainScore, scoreCandidate } from "./score-candidate";
import type { CandidateScore } from "./types";

export const findCandidates: FindCandidates = async (taskId) => {
  const task = await findTaskById(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const busyWorkerUuids = await listBusyWorkerUuids(task.taskId);
  const workers = await listEnabledWorkers();

  const ranked: CandidateScore[] = [];
  for (const worker of workers) {
    const eligibility = evaluateEligibility(task, worker, { busyWorkerUuids });
    if (!eligibility.eligible) continue;
    const scores = scoreCandidate(task, worker);
    ranked.push({
      workerUuid: worker.uuid,
      rank: 0,
      scores,
      reasons: explainScore(task, worker, scores),
    });
  }

  ranked.sort((left, right) => right.scores.final - left.scores.final);
  return ranked.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
};

