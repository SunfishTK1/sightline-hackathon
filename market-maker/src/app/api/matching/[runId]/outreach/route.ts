import { HttpError, withDb } from "@/lib/api/with-db";
import { findMatchingRunById } from "@/lib/db/matching-runs";
import { ensureSchema } from "@/lib/db/schema";
import { outreachBodySchema } from "@/lib/market/schemas";
import { isLiveMessaging } from "@/lib/messaging/imessage";
import { sendOutreachForRun } from "@/lib/messaging/twilio";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  outreachBodySchema.parse(await request.json().catch(() => ({})));

  return withDb(async () => {
    await ensureSchema();
    const run = await findMatchingRunById(runId);
    if (!run) {
      throw new HttpError(404, "Matching run not found");
    }
    const candidateIds = await sendOutreachForRun(runId);
    return {
      runId,
      candidateIds,
      live: isLiveMessaging(),
    };
  });
}
