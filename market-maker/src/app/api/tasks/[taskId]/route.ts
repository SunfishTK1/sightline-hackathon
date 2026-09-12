import { HttpError, withDb } from "@/lib/api/with-db";
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
    return { task };
  });
}
