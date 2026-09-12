/** @owner Divya */
import { ScoreBars } from "./ScoreBars";
import { MatchReason } from "./MatchReason";
import { MOCK_CANDIDATES } from "@/mocks/candidates";

export function CandidateList({ taskId }: { taskId: string }) {
  void taskId;
  // TODO(Divya): fetch from POST /api/tasks/:id/match
  return (
    <ul className="space-y-4">
      {MOCK_CANDIDATES.map((c) => (
        <li key={c.uuid} className="space-y-2 border border-border p-4">
          <div className="flex items-baseline justify-between">
            <p className="font-medium">{c.firstName ?? c.uuid}</p>
            <p className="font-mono text-lg tabular-nums">{c.matchScore.toFixed(2)}</p>
          </div>
          <ScoreBars
            vector={c.vectorScore ?? 0}
            rating={c.ratingScore ?? 0}
            experience={c.experienceScore ?? 0}
          />
          <MatchReason reasons={c.reasons} />
        </li>
      ))}
    </ul>
  );
}
