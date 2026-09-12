import { HttpError, withDb } from "@/lib/api/with-db";
import { listCandidatesForRun } from "@/lib/db/candidates";
import { findTaskById } from "@/lib/db/tasks";
import { toCandidateViews } from "@/lib/market/candidate-views";
import { createMatchingRun } from "@/lib/market/create-matching-run";
import { selectOutreachBatch } from "@/lib/market/send-outreach";
import { startMatchBodySchema } from "@/lib/market/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  startMatchBodySchema.parse(await request.json().catch(() => ({})));

  return withDb(async () => {
    const task = await findTaskById(taskId);
    if (!task) {
      throw new HttpError(404, "Task not found");
    }

    const run = await createMatchingRun(taskId);
    const stored = await listCandidatesForRun(run.matchingRunId);
    const views = await toCandidateViews(stored);
    const outreach = await selectOutreachBatch(run.matchingRunId);

    return {
      run,
      candidates: views,
      topFive: views.slice(0, 5),
      outreachBatch: outreach.map((candidate) => candidate.workerUuid),
    };
  });
}
