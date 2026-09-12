import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { boardWithDeal, decideLiveDeal } from "@/lib/live/deal";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return withDb(async () => {
    await ensureSchema();
    const { token } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "accept" && body.action !== "decline" && body.action !== "cancel") {
      throw new HttpError(400, "action must be accept, decline, or cancel");
    }
    const board = await decideLiveDeal(token, body.action);
    if (!board) throw new HttpError(404, "Live board not found");
    return boardWithDeal(board);
  });
}