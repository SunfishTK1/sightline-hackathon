import { listCandidatesForRun } from "@/lib/db/candidates";
import { findMatchingRunById } from "@/lib/db/matching-runs";
import { OUTREACH_BATCH_SIZE } from "./constants";
import type { SelectOutreachBatch } from "./contracts";

export const selectOutreachBatch: SelectOutreachBatch = async (runId) => {
  const run = await findMatchingRunById(runId);
  if (!run) {
    throw new Error(`Matching run ${runId} not found`);
  }
  const candidates = await listCandidatesForRun(runId);
  return candidates
    .filter((candidate) => candidate.status === "SHORTLISTED")
    .sort((left, right) => left.rank - right.rank)
    .slice(0, OUTREACH_BATCH_SIZE);
};
