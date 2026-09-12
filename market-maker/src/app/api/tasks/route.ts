import { withDb } from "@/lib/api/with-db";
import { listTasks } from "@/lib/db/tasks";

export async function GET() {
  return withDb(async () => ({ tasks: await listTasks() }));
}
