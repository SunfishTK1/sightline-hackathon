import type { Message } from "@/lib/market/types";
import { query } from "./client";
import { fromJson, toJson } from "./json";

export async function insertMessage(message: Message): Promise<void> {
  await query(
    `INSERT INTO messages (message_id, provider_message_id, user_uuid, doc, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      message.messageId,
      message.providerMessageId ?? null,
      message.userUuid,
      toJson(message),
      message.createdAt,
    ],
  );
}

export async function findLatestOutboundForUser(
  userUuid: string,
): Promise<Message | null> {
  const result = await query<{ doc: unknown }>(
    `SELECT doc FROM messages
     WHERE user_uuid = $1 AND doc->>'direction' = 'OUTBOUND'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userUuid],
  );
  return result.rows[0] ? fromJson<Message>(result.rows[0].doc) : null;
}

export async function listRecentOutboundForUser(
  userUuid: string,
  limit = 5,
): Promise<Message[]> {
  const result = await query<{ doc: unknown }>(
    `SELECT doc FROM messages
     WHERE user_uuid = $1 AND doc->>'direction' = 'OUTBOUND'
     ORDER BY created_at DESC
     LIMIT $2`,
    [userUuid, limit],
  );
  return result.rows.map((row) => fromJson<Message>(row.doc));
}

export async function findMessageByProviderId(
  providerMessageId: string,
): Promise<Message | null> {
  const result = await query<{ doc: unknown }>(
    "SELECT doc FROM messages WHERE provider_message_id = $1",
    [providerMessageId],
  );
  return result.rows[0] ? fromJson<Message>(result.rows[0].doc) : null;
}

export async function updateMessageStatus(
  providerMessageId: string,
  status: Message["status"],
): Promise<boolean> {
  const result = await query(
    `UPDATE messages
     SET doc = jsonb_set(doc, '{status}', to_jsonb($2::text))
     WHERE provider_message_id = $1`,
    [providerMessageId, status],
  );
  return (result.rowCount ?? 0) === 1;
}
