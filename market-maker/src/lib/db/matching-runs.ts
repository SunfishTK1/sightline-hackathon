import type { MatchingRun } from "@/lib/market/types";
import { query } from "./client";
import { fromJson, toJson } from "./json";

export async function insertMatchingRun(run: MatchingRun): Promise<void> {
  await query(
    `INSERT INTO matching_runs (matching_run_id, task_id, status, doc, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      run.matchingRunId,
      run.taskId,
      run.status,
      toJson(run),
      run.createdAt,
      run.updatedAt,
    ],
  );
}

export async function findMatchingRunById(
  matchingRunId: string,
): Promise<MatchingRun | null> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM matching_runs WHERE matching_run_id = $1",
    [matchingRunId],
  );
  return result.rows[0] ? fromJson<MatchingRun>(result.rows[0].doc) : null;
}

export async function countMatchingRunsForTask(taskId: string): Promise<number> {
  const result = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM matching_runs WHERE task_id = $1",
    [taskId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function updateMatchingRun(
  matchingRunId: string,
  fields: Partial<Omit<MatchingRun, "matchingRunId">>,
): Promise<boolean> {
  const result = await query(
    `UPDATE matching_runs
     SET doc = doc || $2::jsonb,
         status = COALESCE($2::jsonb->>'status', status),
         updated_at = NOW()
     WHERE matching_run_id = $1`,
    [matchingRunId, toJson({ ...fields, updatedAt: new Date() })],
  );
  return (result.rowCount ?? 0) === 1;
}
