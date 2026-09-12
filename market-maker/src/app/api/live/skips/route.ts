import { withDb } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { listSkipRequests } from "@/lib/db/live";

export async function GET() {
  return withDb(async () => {
    await ensureSchema();
    return { skips: await listSkipRequests() };
  });
}
