import { newId } from "@/lib/ids";
import type { Actor, TaskEvent } from "@/lib/market/types";
import { query } from "./client";
import { fromJson, toJson } from "./json";

export async function appendTaskEvent(input: {
  taskId: string;
  type: string;
  actor: Actor;
  metadata?: Record<string, unknown>;
}): Promise<TaskEvent> {
  const event: TaskEvent = {
    eventId: newId("evt"),
    taskId: input.taskId,
    type: input.type,
    actor: input.actor,
    metadata: input.metadata ?? {},
    createdAt: new Date(),
  };
  await query(
    `INSERT INTO task_events (event_id, task_id, created_at, doc)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [event.eventId, event.taskId, event.createdAt, toJson(event)],
  );
  return event;
}

export async function listTaskEvents(taskId: string): Promise<TaskEvent[]> {
  const result = await query<{ doc: unknown }>(
    `SELECT doc FROM task_events
     WHERE task_id = $1
     ORDER BY created_at ASC`,
    [taskId],
  );
  return result.rows.map((row) => fromJson<TaskEvent>(row.doc));
}
