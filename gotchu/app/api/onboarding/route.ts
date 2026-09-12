/**
 * @owner Will — POST create/update user. No login required to register.
 *
 * Email confirmation is delegated to Auth0, and it's re-demanded on
 * *every* submission, not just the first: each POST creates/finds the
 * corresponding Auth0 database-connection user via the Management API,
 * forces it back to unverified if a prior click had verified it, and asks
 * Auth0 to send a fresh verification email. The record is saved with
 * emailVerified: false — and unusable for anything that needs a real
 * inbox — until Auth0 reports back that the (new) link was clicked. That
 * means editing your profile always requires re-confirming your email
 * afterward, by design — not just registering for the first time.
 */
import { cookies } from "next/headers";
import {
  auth0ManagementConfigured,
  findOrCreateAuth0User,
  sendAuth0VerificationEmail,
  setAuth0EmailUnverified,
} from "@/lib/auth0-management";
import { fail, ok } from "@/lib/http";
import { getIdentity, IDENTITY_COOKIE, identityCookieValue } from "@/lib/identity";
import {
  findUserByAuth0Sub,
  findUserByCmuEmail,
  PhoneAlreadyRegisteredError,
  publicUser,
  upsertUser,
} from "@/lib/users";
import { isCmuEmail, onboardingSchema } from "@/lib/validate";
import type { User } from "@/lib/types/user";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid onboarding payload");
  }

  const input = parsed.data;
  if (!isCmuEmail(input.cmuEmail)) {
    return fail("Must be a verified CMU address ending in @andrew.cmu.edu", 403);
  }

  // A returning visitor (identity cookie already set) updates their own
  // record. Fall back to a lookup by email so a record that's already
  // verified isn't re-created (and re-verified) just because the cookie
  // was lost.
  const identity = await getIdentity();
  const existing =
    (identity ? await findUserByAuth0Sub(identity.auth0Sub) : null) ??
    (await findUserByCmuEmail(input.cmuEmail));

  let auth0Sub = existing?.auth0Sub ?? null;
  let emailVerified: boolean;
  let emailVerifiedAt: string | undefined;

  if (auth0ManagementConfigured()) {
    const auth0User = await findOrCreateAuth0User(input.cmuEmail);
    auth0Sub = auth0User.user_id;
    if (auth0User.email_verified) {
      await setAuth0EmailUnverified(auth0User.user_id);
    }
    await sendAuth0VerificationEmail(auth0User.user_id);
    emailVerified = false;
    emailVerifiedAt = undefined;
  } else {
    // Dev fallback so onboarding still works without an Auth0 tenant configured.
    auth0Sub ??= `local|${input.cmuEmail}`;
    emailVerified = true;
    emailVerifiedAt = new Date().toISOString();
    console.warn("AUTH0_M2M_* not configured — skipping email verification.");
  }

  const now = new Date().toISOString();
  const phoneChanged = Boolean(existing && existing.phone !== input.phone);

  const user: User = {
    uuid: existing?.uuid ?? "",
    auth0Sub: auth0Sub!,
    firstName: input.firstName,
    lastName: input.lastName,
    cmuEmail: input.cmuEmail,
    phone: input.phone,
    emailVerified,
    emailVerifiedAt,
    // Omitted (not re-uploaded) on this submission just means "keep what's
    // already saved" — upsertUser only overwrites it when a new one is sent.
    photoDataUrl: input.photoDataUrl ?? existing?.photoDataUrl,
    preferenceText: existing?.preferenceText ?? "",
    preferenceEmbedding: existing?.preferenceEmbedding ?? [],
    consents: {
      age18: input.ageConfirmed,
      canCall: input.consentCall,
      canText: input.consentText,
      acceptedAt: now,
    },
    availability: existing?.availability ?? { isAvailable: false },
    stats: existing?.stats ?? {
      tasksCompleted: 0,
      tasksRequested: 0,
      avgRating: null,
      ratingCount: 0,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  let saved: User;
  let wasExisting: boolean;
  try {
    ({ user: saved, wasExisting } = await upsertUser(user));
  } catch (err) {
    if (err instanceof PhoneAlreadyRegisteredError) {
      return fail(err.message, 409);
    }
    throw err;
  }

  const jar = await cookies();
  jar.set(IDENTITY_COOKIE, identityCookieValue({ auth0Sub: user.auth0Sub, cmuEmail: input.cmuEmail }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return ok(
    { user: publicUser(saved), needsVerification: !emailVerified, wasExisting, phoneChanged },
    wasExisting ? 200 : 201,
  );
}
