import { HttpError, withDb } from "@/lib/api/with-db";
import { listCandidatesForTask } from "@/lib/db/candidates";
import { findTaskById } from "@/lib/db/tasks";
import { toCandidateViews } from "@/lib/market/candidate-views";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const runId = new URL(request.url).searchParams.get("runId") ?? undefined;

  return withDb(async () => {
    const task = await findTaskById(taskId);
    if (!task) {
      throw new HttpError(404, "Task not found");
    }
    const matchingRunId = runId ?? task.activeMatchingRunId;
    const candidates = await listCandidatesForTask(taskId, matchingRunId);
    return {
      taskId,
      matchingRunId: matchingRunId ?? null,
      candidates: await toCandidateViews(candidates),
    };
  });
}
