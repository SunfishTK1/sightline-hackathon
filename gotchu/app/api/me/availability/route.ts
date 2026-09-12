/** @owner Will — PATCH availability.isAvailable */
import { fail, ok } from "@/lib/http";
import { getIdentity } from "@/lib/identity";
import { findUserByAuth0Sub, publicUser, upsertUser } from "@/lib/users";
import { availabilitySchema } from "@/lib/validate";

export async function PATCH(req: Request) {
  const identity = await getIdentity();
  if (!identity) {
    return fail("Not signed in.", 401);
  }

  const existing = await findUserByAuth0Sub(identity.auth0Sub);
  if (!existing) {
    return fail("Complete onboarding first.", 404);
  }
  if (!existing.emailVerified) {
    return fail("Confirm your CMU email before going available.", 403);
  }

  const body = await req.json().catch(() => null);
  const parsed = availabilitySchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid availability");
  }

  const { user: saved } = await upsertUser({
    ...existing,
    availability: {
      isAvailable: parsed.data.isAvailable,
      until: parsed.data.until,
    },
    updatedAt: new Date().toISOString(),
  });

  return ok({ user: publicUser(saved) });
}
