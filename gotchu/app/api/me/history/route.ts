/**
 * @owner Claude
 * This person's own task history and wallet balance - used to refresh the
 * account view without a full page reload. Identity comes from the same
 * httpOnly cookie set at onboarding; there is no separate login step.
 */
import { fail, ok } from "@/lib/http";
import { getIdentity } from "@/lib/identity";
import { findUserByAuth0Sub } from "@/lib/users";
import { getRequestHistory, getWorkHistory, getWalletSummary } from "@/lib/history";

export async function GET() {
  const identity = await getIdentity();
  if (!identity) return fail("Not signed in.", 401);

  const user = await findUserByAuth0Sub(identity.auth0Sub);
  if (!user) return fail("Complete onboarding first.", 404);

  const [requests, work, wallet] = await Promise.all([
    getRequestHistory(user.uuid),
    getWorkHistory(user.uuid),
    getWalletSummary(user.uuid),
  ]);
  return ok({ requests, work, wallet });
}
