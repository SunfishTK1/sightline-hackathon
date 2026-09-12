import type { Task, TaskStatus } from "@/lib/market/types";
import { query } from "./client";
import { fromJson, toJson } from "./json";

export async function upsertTask(task: Task): Promise<void> {
  await query(
    `INSERT INTO tasks (task_id, requester_uuid, status, doc, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (task_id) DO UPDATE SET
       requester_uuid = EXCLUDED.requester_uuid,
       status = EXCLUDED.status,
       doc = EXCLUDED.doc,
       updated_at = EXCLUDED.updated_at`,
    [
      task.taskId,
      task.requesterUuid,
      task.status,
      toJson(task),
      task.createdAt,
      task.updatedAt,
    ],
  );
}

export async function listOpenTasksForRequester(
  requesterUuid: string,
): Promise<Task[]> {
  const result = await query<{ doc: unknown }>(
    `SELECT doc FROM tasks
     WHERE requester_uuid = $1
       AND status <> ALL($2::text[])
     ORDER BY created_at DESC`,
    [requesterUuid, ["COMPLETED", "CANCELLED", "NO_MATCH"]],
  );
  return result.rows.map((row) => fromJson<Task>(row.doc));
}

export async function findTaskById(taskId: string): Promise<Task | null> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM tasks WHERE task_id = $1",
    [taskId],
  );
  return result.rows[0] ? fromJson<Task>(result.rows[0].doc) : null;
}

export async function listTasks(): Promise<Task[]> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM tasks ORDER BY created_at DESC",
  );
  return result.rows.map((row) => fromJson<Task>(row.doc));
}

export async function updateTaskFields(
  taskId: string,
  fields: Partial<Omit<Task, "taskId">>,
): Promise<boolean> {
  const result = await query(
    `UPDATE tasks
     SET doc = doc || $2::jsonb,
         status = COALESCE($2::jsonb->>'status', status),
         updated_at = NOW()
     WHERE task_id = $1`,
    [taskId, toJson({ ...fields, updatedAt: new Date() })],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function transitionTaskStatus(
  taskId: string,
  expectedStatus: TaskStatus,
  nextStatus: TaskStatus,
): Promise<boolean> {
  const result = await query(
    `UPDATE tasks
     SET status = $3,
         doc = jsonb_set(
           jsonb_set(doc, '{status}', to_jsonb($3::text)),
           '{updatedAt}',
           to_jsonb(NOW())
         ),
         updated_at = NOW()
     WHERE task_id = $1 AND status = $2`,
    [taskId, expectedStatus, nextStatus],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function findTasksByStatus(status: TaskStatus): Promise<Task[]> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM tasks WHERE status = $1",
    [status],
  );
  return result.rows.map((row) => fromJson<Task>(row.doc));
}

export async function listBusyWorkerUuids(
  exceptTaskId: string,
): Promise<Set<string>> {
  const result = await query<{ uuid: string }>(
    `SELECT doc->>'matchedWorkerUuid' AS uuid
     FROM tasks
     WHERE task_id <> $1
       AND status = ANY($2::text[])
       AND doc->>'matchedWorkerUuid' IS NOT NULL`,
    [exceptTaskId, ["ACCEPTED", "IN_PROGRESS", "PENDING_BOTH_APPROVALS"]],
  );
  return new Set(result.rows.map((row) => row.uuid).filter(Boolean));
}
