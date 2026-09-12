/**
 * @owner Claude
 * Get back into an existing account without re-onboarding. There is no
 * password anywhere in this app - Auth0's verification email is the login.
 * This resends it and re-issues the identity cookie on whichever host asked,
 * without touching name, phone, photo, or consents.
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
import { IDENTITY_COOKIE, identityCookieValue } from "@/lib/identity";
import { findUserByCmuEmail, upsertUser } from "@/lib/users";
import { isCmuEmail, normalizeCmuEmail } from "@/lib/validate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.cmuEmail === "string" ? normalizeCmuEmail(body.cmuEmail) : "";
  if (!email || !isCmuEmail(email)) {
    return fail("Enter the @andrew.cmu.edu email you onboarded with.");
  }

  const existing = await findUserByCmuEmail(email);
  if (!existing) {
    return fail("No Gotchu account found for that email - join below instead.", 404);
  }

  let emailVerified = existing.emailVerified;
  let emailVerifiedAt = existing.emailVerifiedAt;
  let auth0Sub = existing.auth0Sub;

  if (auth0ManagementConfigured()) {
    try {
      const auth0User = await findOrCreateAuth0User(email);
      auth0Sub = auth0User.user_id;
      if (auth0User.email_verified) {
        await setAuth0EmailUnverified(auth0User.user_id);
      }
      await sendAuth0VerificationEmail(auth0User.user_id);
      emailVerified = false;
      emailVerifiedAt = undefined;
    } catch (err) {
      console.error(`Auth0 relink failed for ${email}: ${(err as Error).message}`);
      return fail("Could not send a sign-in email right now. Try again shortly.", 502);
    }
  } else {
    console.error(
      `Auth0 Management API not configured (missing: ${missingAuth0EnvVars().join(", ") || "unknown"}) ` +
        "- relink is issuing the cookie without a real verification step.",
    );
  }

  // Only identity/verification fields change - profile, phone, photo, and
  // consents are carried through exactly as they were.
  const { user: saved } = await upsertUser({
    ...existing,
    auth0Sub: auth0Sub || existing.auth0Sub,
    emailVerified,
    emailVerifiedAt,
    updatedAt: new Date().toISOString(),
  });

  const jar = await cookies();
  jar.set(IDENTITY_COOKIE, identityCookieValue({ auth0Sub: saved.auth0Sub, cmuEmail: email }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return ok({ needsVerification: !emailVerified });
}
