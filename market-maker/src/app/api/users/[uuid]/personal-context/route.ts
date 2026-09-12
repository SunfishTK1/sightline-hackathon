import { HttpError, withDb } from "@/lib/api/with-db";
import { findUserByUuid } from "@/lib/db/users";
import { toPersonalAgentContext } from "@/lib/personal-agent/context";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  return withDb(async () => {
    const user = await findUserByUuid(uuid);
    if (!user) {
      throw new HttpError(404, "User not found");
    }
    return { context: toPersonalAgentContext(user) };
  });
}
