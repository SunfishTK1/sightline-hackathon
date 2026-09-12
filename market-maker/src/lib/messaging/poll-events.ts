import { getState, setState } from "@/lib/db/state";
import type { InboundSms } from "@/lib/market/types";
import { listIMessageEvents } from "./imessage";
import { handleInboundMessage } from "./twilio";

const CURSOR_KEY = "imessage_event_cursor";

export async function pollIMessageEvents(): Promise<{
  processed: number;
  nextCursor: number;
}> {
  const after = await getState<number>(CURSOR_KEY, 0);
  const page = await listIMessageEvents(after);
  let processed = 0;

  for (const event of page.events) {
    if (event.type === "message.received" && event.data.sender) {
      const inbound: InboundSms = {
        providerMessageId: event.data.providerMessageId ?? event.id,
        from: event.data.sender,
        body: event.data.body ?? "",
        receivedAt: event.data.receivedAt
          ? new Date(event.data.receivedAt)
          : new Date(event.createdAt),
      };
      await handleInboundMessage(inbound);
      processed += 1;
    }
  }

  await setState(CURSOR_KEY, page.nextCursor);
  return { processed, nextCursor: page.nextCursor };
}
