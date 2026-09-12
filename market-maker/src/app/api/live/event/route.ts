import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { recordLiveEvent } from "@/lib/db/live";

export async function POST(request: Request) {
  return withDb(async () => {
    await ensureSchema();
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string;
      token?: string;
      kind?: string;
      message?: string;
      slot?: number;
      offerId?: string;
      state?: "queued" | "considering" | "waiting" | "countered" | "declined" | "dropped" | "accepted";
      waitingUntil?: string;
      addSlot?: boolean;
    };
    const { kind, message } = body;
    if ((!body.orderId && !body.token) || !kind || !message) {
      throw new HttpError(400, "orderId or token, kind, and message are required");
    }
    // Passed explicitly: the guard above narrows the locals, but not the
    // fields of `body` when the whole object is handed on.
    const view = await recordLiveEvent({ ...body, kind, message });
    if (!view) throw new HttpError(404, "No live board for that order");
    return view;
  });
}
