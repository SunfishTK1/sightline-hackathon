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
  missingAuth0EnvVars,
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
import { activateParticipant, dropWorkerAvailability } from "@/lib/activate";
import { TERMS_VERSION } from "@/lib/terms";
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
  if (identity && identity.cmuEmail !== input.cmuEmail) {
    return fail(
      "This session is already tied to a different CMU email. Sign out to register a new account.",
      409,
    );
  }

  const existing =
    (identity ? await findUserByAuth0Sub(identity.auth0Sub) : null) ??
    (await findUserByCmuEmail(input.cmuEmail));

  // A verified account cannot be overwritten by anyone who merely knows the
  // email. First-time / still-unverified resubmits stay allowed so the
  // confirmation email can be resent from another browser.
  if (existing?.emailVerified && (!identity || identity.cmuEmail !== existing.cmuEmail)) {
    return fail("This email is already registered. Sign in to update your profile.", 409);
  }

  let auth0Sub = existing?.auth0Sub ?? null;
  let emailVerified: boolean;
  let emailVerifiedAt: string | undefined;

  if (auth0ManagementConfigured()) {
    try {
      const auth0User = await findOrCreateAuth0User(input.cmuEmail);
      auth0Sub = auth0User.user_id;
      if (auth0User.email_verified) {
        await setAuth0EmailUnverified(auth0User.user_id);
      }
      await sendAuth0VerificationEmail(auth0User.user_id);
      emailVerified = false;
      emailVerifiedAt = undefined;
    } catch (err) {
      // Never silently mark someone verified because Auth0 hiccuped - that's
      // the exact bug this is guarding against. Log loudly (this should show
      // up in Railway's deploy logs) and fail the request for a brand-new
      // identity; for an existing one, keep going but leave them unverified.
      console.error(
        `Auth0 email verification failed for ${input.cmuEmail}: ${(err as Error).message}`,
      );
      if (!auth0Sub) {
        return fail("Could not send a verification email right now. Please try again shortly.", 502);
      }
      emailVerified = false;
      emailVerifiedAt = undefined;
    }
  } else {
    // Dev-only fallback so onboarding still works without an Auth0 tenant
    // configured locally. In production this should never trigger - if it
    // does, these are exactly the env vars missing on the deploy.
    console.error(
      `Auth0 Management API not configured (missing: ${missingAuth0EnvVars().join(", ") || "unknown"}) ` +
        "- skipping real email verification.",
    );
    auth0Sub ??= `local|${input.cmuEmail}`;
    emailVerified = true;
    emailVerifiedAt = new Date().toISOString();
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
      acceptedTerms: input.acceptedTerms,
      termsVersion: TERMS_VERSION,
      canUseLikeness: input.consentLikeness ?? false,
      acceptedAt: now,
    },
    availability: phoneChanged ? { isAvailable: false } : (existing?.availability ?? { isAvailable: false }),
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

  // Saving the person is not the same as joining the marketplace: give them a
  // worker profile and let their agent introduce itself. Deliberately after the
  // save, and deliberately unable to fail it.
  await activateParticipant({
    personId: saved.uuid,
    phone: saved.phone,
    displayName: [saved.firstName, saved.lastName].filter(Boolean).join(" ") || null,
    blurb: saved.preferenceText,
  });
  if (phoneChanged) {
    await dropWorkerAvailability(saved.uuid);
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
