import { appendTaskEvent } from "@/lib/db/events";
import { insertCandidates } from "@/lib/db/candidates";
import {
  countMatchingRunsForTask,
  insertMatchingRun,
} from "@/lib/db/matching-runs";
import { findTaskById, updateTaskFields } from "@/lib/db/tasks";
import { newId } from "@/lib/ids";
import type { CreateMatchingRun } from "./contracts";
import { findCandidates } from "./find-candidates";
import { transitionTask } from "./transition";
import type { TaskCandidate } from "./types";

export const createMatchingRun: CreateMatchingRun = async (taskId) => {
  const task = await findTaskById(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const scores = await findCandidates(taskId);
  const now = new Date();
  const matchingRunId = newId("run");
  const attempt = (await countMatchingRunsForTask(taskId)) + 1;

  const candidates: TaskCandidate[] = scores.map((score) => ({
    candidateId: newId("cand"),
    taskId,
    workerUuid: score.workerUuid,
    matchingRunId,
    rank: score.rank,
    scores: score.scores,
    reasons: score.reasons,
    invitation: { status: "QUEUED" },
    response: {},
    status: "SHORTLISTED",
    createdAt: now,
    updatedAt: now,
  }));

  const run = {
    matchingRunId,
    taskId,
    attempt,
    terms: {
      priceUsd: task.pricing.currentOfferUsd,
      deadline: task.structured.deadline,
    },
    candidateIds: candidates.map((candidate) => candidate.candidateId),
    status: "CREATED" as const,
    createdAt: now,
    updatedAt: now,
  };

  await insertMatchingRun(run);
  await insertCandidates(candidates);

  const transitioned = await transitionTask(taskId, task.status, "MATCHING");
  if (!transitioned) {
    await updateTaskFields(taskId, {
      status: "MATCHING",
      activeMatchingRunId: matchingRunId,
    });
  } else {
    await updateTaskFields(taskId, { activeMatchingRunId: matchingRunId });
  }

  await appendTaskEvent({
    taskId,
    type: "MATCHING_RUN_CREATED",
    actor: "MARKET_AGENT",
    metadata: {
      matchingRunId,
      attempt,
      candidateCount: candidates.length,
    },
  });

  return run;
};
