import type { Negotiation, NegotiationEvent } from "@/lib/market/types";
import { query } from "./client";
import { fromJson, toJson } from "./json";

export async function insertNegotiation(
  negotiation: Negotiation,
): Promise<void> {
  await query(
    `INSERT INTO negotiations (
       negotiation_id, task_id, requester_uuid, worker_uuid, state, doc, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      negotiation.negotiationId,
      negotiation.taskId,
      negotiation.requesterUuid,
      negotiation.workerUuid,
      negotiation.state,
      toJson(negotiation),
      negotiation.createdAt,
      negotiation.updatedAt,
    ],
  );
}

export async function findNegotiationById(
  negotiationId: string,
): Promise<Negotiation | null> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM negotiations WHERE negotiation_id = $1",
    [negotiationId],
  );
  return result.rows[0] ? fromJson<Negotiation>(result.rows[0].doc) : null;
}

export async function findActiveNegotiationForUser(
  userUuid: string,
): Promise<Negotiation | null> {
  const result = await query<{ doc: unknown }>(
    `SELECT doc FROM negotiations
     WHERE (requester_uuid = $1 OR worker_uuid = $1)
       AND state = ANY($2::text[])
     ORDER BY created_at DESC
     LIMIT 1`,
    [
      userUuid,
      [
        "WAITING_FOR_WORKER",
        "EVALUATING_WORKER_RESPONSE",
        "WAITING_FOR_REQUESTER",
        "READY_FOR_APPROVAL",
      ],
    ],
  );
  return result.rows[0] ? fromJson<Negotiation>(result.rows[0].doc) : null;
}

export async function appendNegotiationEvent(
  negotiationId: string,
  event: NegotiationEvent,
  extra?: Partial<Omit<Negotiation, "negotiationId" | "events">>,
): Promise<boolean> {
  const result = await query(
    `UPDATE negotiations
     SET doc = jsonb_set(doc || $2::jsonb, '{events}', COALESCE(doc->'events', '[]'::jsonb) || $3::jsonb),
         state = COALESCE($2::jsonb->>'state', state),
         updated_at = NOW()
     WHERE negotiation_id = $1`,
    [
      negotiationId,
      toJson({ ...extra, updatedAt: new Date() }),
      toJson([event]),
    ],
  );
  return (result.rowCount ?? 0) === 1;
}
