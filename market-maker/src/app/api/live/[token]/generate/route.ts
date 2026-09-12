import { after } from "next/server";
import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { loadLiveBoard } from "@/lib/db/live";
import { generateLiveMedia } from "@/lib/live/generate-media";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return withDb(async () => {
    await ensureSchema();
    const { token } = await context.params;
    const board = await loadLiveBoard(token);
    if (!board) throw new HttpError(404, "Live board not found");
    after(() => {
      void generateLiveMedia(token);
    });
    return board;
  });
}
