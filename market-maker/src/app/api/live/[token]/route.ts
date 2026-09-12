import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { loadLiveBoard } from "@/lib/db/live";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return withDb(async () => {
    await ensureSchema();
    const { token } = await context.params;
    const board = await loadLiveBoard(token);
    if (!board) throw new HttpError(404, "Live board not found");
    return board;
  });
}
