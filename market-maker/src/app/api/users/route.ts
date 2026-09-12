import { withDb } from "@/lib/api/with-db";
import { listUsersPublic } from "@/lib/db/users";

export async function GET() {
  return withDb(async () => ({ users: await listUsersPublic() }));
}
