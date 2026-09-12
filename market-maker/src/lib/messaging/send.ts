import { insertMessage } from "@/lib/db/messages";
import { newId } from "@/lib/ids";
import type { Message, MessagePurpose } from "@/lib/market/types";
import { enrollRecipient, isLiveMessaging, sendIMessage } from "./imessage";

export async function sendUserMessage(input: {
  userUuid: string;
  phone: string;
  body: string;
  purpose: MessagePurpose;
  taskId?: string;
  negotiationId?: string;
  forceLive?: boolean;
}): Promise<Message> {
  const message: Message = {
    messageId: newId("msg"),
    provider: "IMESSAGE",
    userUuid: input.userUuid,
    taskId: input.taskId,
    negotiationId: input.negotiationId,
    direction: "OUTBOUND",
    purpose: input.purpose,
    body: input.body,
    status: "QUEUED",
    createdAt: new Date(),
  };

  const live =
    input.purpose === "WORKER_INVITATION"
      ? isLiveMessaging()
      : Boolean(input.forceLive || isLiveMessaging());
  if (live) {
    await enrollRecipient(input.phone);
  }

  const result = await sendIMessage({
    to: input.phone,
    text: input.body,
    dryRun: !live,
    idempotencyKey: message.messageId,
  });

  message.providerMessageId = result.providerMessageId ?? result.requestId;
  message.status = result.dryRun ? "QUEUED" : "SENT";
  await insertMessage(message);
  return message;
}
