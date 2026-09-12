import { withDb } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { pollIMessageEvents } from "@/lib/messaging/poll-events";

export async function POST() {
  return withDb(async () => {
    await ensureSchema();
    return pollIMessageEvents();
  });
}

export async function GET() {
  return POST();
}
