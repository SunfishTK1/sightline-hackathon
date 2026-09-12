import { after } from "next/server";
import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { startLiveBoard } from "@/lib/db/live";
import { generateLiveMedia } from "@/lib/live/generate-media";

export const maxDuration = 300;

export async function POST(request: Request) {
  return withDb(async () => {
    await ensureSchema();
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string;
      title?: string;
      category?: string;
      deadlineAt?: string;
      slots?: number;
    };
    if (!body.orderId || !body.title) {
      throw new HttpError(400, "orderId and title are required");
    }
    const board = await startLiveBoard({
      orderId: body.orderId,
      title: body.title,
      category: body.category,
      deadlineAt: body.deadlineAt,
      slots: body.slots,
    });
    after(() => {
      void generateLiveMedia(board.token);
    });
    return board;
  });
}
