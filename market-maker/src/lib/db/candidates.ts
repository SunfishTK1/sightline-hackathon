import type { CandidateStatus, TaskCandidate } from "@/lib/market/types";
import { query, withClient } from "./client";
import { fromJson, toJson } from "./json";

export async function insertCandidates(
  candidates: TaskCandidate[],
): Promise<void> {
  if (candidates.length === 0) return;

  await withClient(async (client) => {
    for (const candidate of candidates) {
      await client.query(
        `INSERT INTO task_candidates (
           candidate_id, task_id, worker_uuid, matching_run_id, status, rank, doc, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [
          candidate.candidateId,
          candidate.taskId,
          candidate.workerUuid,
          candidate.matchingRunId,
          candidate.status,
          candidate.rank,
          toJson(candidate),
          candidate.createdAt,
          candidate.updatedAt,
        ],
      );
    }
  });
}

export async function findCandidateById(
  candidateId: string,
): Promise<TaskCandidate | null> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM task_candidates WHERE candidate_id = $1",
    [candidateId],
  );
  return result.rows[0] ? fromJson<TaskCandidate>(result.rows[0].doc) : null;
}

export async function listCandidatesForTask(
  taskId: string,
  matchingRunId?: string,
): Promise<TaskCandidate[]> {
  const result = matchingRunId
    ? await query<{ doc: unknown }>(
        `SELECT doc FROM task_candidates
         WHERE task_id = $1 AND matching_run_id = $2
         ORDER BY rank ASC`,
        [taskId, matchingRunId],
      )
    : await query<{ doc: unknown }>(
        `SELECT doc FROM task_candidates
         WHERE task_id = $1
         ORDER BY created_at DESC, rank ASC`,
        [taskId],
      );
  return result.rows.map((row) => fromJson<TaskCandidate>(row.doc));
}

export async function listCandidatesForRun(
  matchingRunId: string,
): Promise<TaskCandidate[]> {
  const result = await query<{ doc: unknown }>(
    `SELECT doc FROM task_candidates
     WHERE matching_run_id = $1
     ORDER BY rank ASC`,
    [matchingRunId],
  );
  return result.rows.map((row) => fromJson<TaskCandidate>(row.doc));
}

export async function findCandidateForTaskAndWorker(
  taskId: string,
  workerUuid: string,
): Promise<TaskCandidate | null> {
  const result = await query<{ doc: unknown }>(
    `SELECT doc FROM task_candidates
     WHERE task_id = $1 AND worker_uuid = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [taskId, workerUuid],
  );
  return result.rows[0] ? fromJson<TaskCandidate>(result.rows[0].doc) : null;
}

export async function findLatestCandidateForWorker(
  workerUuid: string,
): Promise<TaskCandidate | null> {
  const result = await query<{ doc: unknown }>(
    `SELECT doc FROM task_candidates
     WHERE worker_uuid = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [workerUuid],
  );
  return result.rows[0] ? fromJson<TaskCandidate>(result.rows[0].doc) : null;
}

export async function updateCandidate(
  candidateId: string,
  fields: Partial<Omit<TaskCandidate, "candidateId">>,
): Promise<boolean> {
  const result = await query(
    `UPDATE task_candidates
     SET doc = doc || $2::jsonb,
         status = COALESCE($2::jsonb->>'status', status),
         updated_at = NOW()
     WHERE candidate_id = $1`,
    [candidateId, toJson({ ...fields, updatedAt: new Date() })],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function updateCandidatesByStatus(
  matchingRunId: string,
  fromStatus: CandidateStatus,
  fields: Partial<Omit<TaskCandidate, "candidateId">>,
): Promise<number> {
  const result = await query(
    `UPDATE task_candidates
     SET doc = doc || $3::jsonb,
         status = COALESCE($3::jsonb->>'status', status),
         updated_at = NOW()
     WHERE matching_run_id = $1 AND status = $2`,
    [matchingRunId, fromStatus, toJson({ ...fields, updatedAt: new Date() })],
  );
  return result.rowCount ?? 0;
}
