import { withDb } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { ackLiveSkip } from "@/lib/db/live";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return withDb(async () => {
    await ensureSchema();
    const { token } = await context.params;
    await ackLiveSkip(token);
    return { ok: true };
  });
}
