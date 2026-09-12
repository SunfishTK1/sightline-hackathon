import { appendTaskEvent } from "@/lib/db/events";
import { transitionTaskStatus } from "@/lib/db/tasks";
import type { TaskStatus } from "./types";

/**
 * Optimistic status update. Returns false if another webhook already moved
 * the task, so two workers cannot be selected at the same time.
 */
export async function transitionTask(
  taskId: string,
  expectedStatus: TaskStatus,
  nextStatus: TaskStatus,
): Promise<boolean> {
  const changed = await transitionTaskStatus(taskId, expectedStatus, nextStatus);
  if (!changed) {
    return false;
  }

  await appendTaskEvent({
    taskId,
    type: "STATUS_CHANGED",
    actor: "MARKET_AGENT",
    metadata: { from: expectedStatus, to: nextStatus },
  });

  return true;
}
