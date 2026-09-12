/**
 * @owner Will
 * Resolve identity. Never trust a uuid from the client.
 *
 * Registration has no login step: the httpOnly cookie set at
 * onboarding time is the identity. Auth0 is only consulted as a
 * fallback for a signed-in session (not required to use the app).
 */
import { cookies } from "next/headers";
import { getAuth0 } from "./auth0";
import { isCmuEmail, normalizeCmuEmail } from "./validate";

export const IDENTITY_COOKIE = "gotchu_identity";

export type Identity = {
  auth0Sub: string;
  cmuEmail: string;
  source: "auth0" | "local";
};

function parseCookie(raw: string | undefined): Identity | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { auth0Sub?: string; cmuEmail?: string };
    if (!parsed.auth0Sub || !parsed.cmuEmail || !isCmuEmail(parsed.cmuEmail)) {
      return null;
    }
    return {
      auth0Sub: parsed.auth0Sub,
      cmuEmail: normalizeCmuEmail(parsed.cmuEmail),
      source: "local",
    };
  } catch {
    return null;
  }
}

export async function getIdentity(): Promise<Identity | null> {
  const jar = await cookies();
  const fromCookie = parseCookie(jar.get(IDENTITY_COOKIE)?.value);
  if (fromCookie) return fromCookie;

  const auth0 = getAuth0();
  if (!auth0) return null;
  try {
    const session = await auth0.getSession();
    const email = normalizeCmuEmail(session?.user?.email ?? "");
    const sub = session?.user?.sub;
    if (sub && isCmuEmail(email) && session?.user?.email_verified !== false) {
      return { auth0Sub: sub, cmuEmail: email, source: "auth0" };
    }
  } catch {
    return null;
  }
  return null;
}

export async function requireIdentity(): Promise<Identity> {
  const identity = await getIdentity();
  if (!identity) {
    throw new Error("Sign in with a verified @andrew.cmu.edu email first.");
  }
  return identity;
}

export function identityCookieValue(identity: Omit<Identity, "source">): string {
  return JSON.stringify({
    auth0Sub: identity.auth0Sub,
    cmuEmail: normalizeCmuEmail(identity.cmuEmail),
  });
}
