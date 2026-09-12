import { HttpError, withDb } from "@/lib/api/with-db";
import { listTaskEvents } from "@/lib/db/events";
import { findTaskById } from "@/lib/db/tasks";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  return withDb(async () => {
    const task = await findTaskById(taskId);
    if (!task) {
      throw new HttpError(404, "Task not found");
    }
    const events = await listTaskEvents(taskId);
    return { taskId, status: task.status, events };
  });
}
