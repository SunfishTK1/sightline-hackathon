import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { requestLiveSkip } from "@/lib/db/live";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return withDb(async () => {
    await ensureSchema();
    const { token } = await context.params;
    const board = await requestLiveSkip(token);
    if (!board) throw new HttpError(404, "Live board not found");
    return board;
  });
}
