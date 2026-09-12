import { findUsersByUuids } from "@/lib/db/users";
import type { RankedCandidateView, TaskCandidate } from "./types";

export async function toCandidateViews(
  candidates: TaskCandidate[],
): Promise<RankedCandidateView[]> {
  const workers = await findUsersByUuids(
    candidates.map((candidate) => candidate.workerUuid),
  );
  const byUuid = new Map(workers.map((worker) => [worker.uuid, worker]));

  return candidates
    .slice()
    .sort((left, right) => left.rank - right.rank)
    .flatMap((candidate) => {
      const worker = byUuid.get(candidate.workerUuid);
      if (!worker) return [];
      return [
        {
          candidate,
          worker: {
            uuid: worker.uuid,
            firstName: worker.firstName,
            lastName: worker.lastName,
            categories: worker.workerProfile.categories,
            typicalLocations: worker.workerProfile.typicalLocations,
            minPriceUsd: worker.workerProfile.minPriceUsd,
            preferredPriceUsd: worker.workerProfile.preferredPriceUsd,
            preferenceText: worker.preferenceText,
          },
        },
      ];
    });
}
