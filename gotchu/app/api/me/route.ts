/** @owner Will — GET profile, PATCH + preference re-embed */
import { embedText } from "@/lib/embed";
import { fail, ok } from "@/lib/http";
import { getIdentity } from "@/lib/identity";
import { findUserByAuth0Sub, publicUser, refreshEmailVerification, upsertUser } from "@/lib/users";
import { profilePatchSchema } from "@/lib/validate";

export async function GET() {
  const identity = await getIdentity();
  if (!identity) {
    return ok({ user: null, identity: null });
  }
  const found = await findUserByAuth0Sub(identity.auth0Sub);
  const user = found ? await refreshEmailVerification(found) : null;
  return ok({
    user: user ? publicUser(user) : null,
    identity: { cmuEmail: identity.cmuEmail, source: identity.source },
  });
}

export async function PATCH(req: Request) {
  const identity = await getIdentity();
  if (!identity) {
    return fail("Not signed in.", 401);
  }

  const existing = await findUserByAuth0Sub(identity.auth0Sub);
  if (!existing) {
    return fail("Complete onboarding first.", 404);
  }

  const body = await req.json().catch(() => null);
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid profile update");
  }

  const patch = parsed.data;
  const preferenceText = patch.preferenceText ?? existing.preferenceText;
  const preferenceEmbedding =
    patch.preferenceText && patch.preferenceText !== existing.preferenceText
      ? await embedText(patch.preferenceText)
      : existing.preferenceEmbedding;

  const { user: saved } = await upsertUser({
    ...existing,
    firstName: patch.firstName ?? existing.firstName,
    lastName: patch.lastName ?? existing.lastName,
    phone: patch.phone ?? existing.phone,
    preferenceText,
    preferenceEmbedding,
    updatedAt: new Date().toISOString(),
  });

  return ok({ user: publicUser(saved) });
}
