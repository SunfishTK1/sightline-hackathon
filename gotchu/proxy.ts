/**
 * @owner Will
 * @shared true — message team before changing
 *
 * Auth0 v4 mounts /auth/login, /auth/callback, /auth/logout,
 * /auth/profile. Skip the SDK when tenant env is missing so local
 * onboarding can still be tested.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0, getAuth0 } from "@/lib/auth0";

/**
 * One host, for the same reason there is one page.
 *
 * Two domains point at this service, and the session is an httpOnly cookie
 * with no domain attribute - so it is host-only. Someone who onboarded on the
 * railway.app host is a stranger on gotchu.velroi.com and gets the join form
 * again, with their account and history apparently gone. That is not a stale
 * deployment: both hosts serve the same build. It is two cookie jars, which is
 * the same fork SITE_NAVIGATION.md exists to prevent, one level down.
 *
 * Unset means no redirect, so a misconfiguration can only ever be a no-op.
 */
const CANONICAL_HOST = process.env.CANONICAL_HOST?.trim().toLowerCase() || "";

function canonicalRedirect(request: NextRequest): NextResponse | null {
  if (!CANONICAL_HOST) return null;
  const host = request.headers.get("host")?.toLowerCase();
  if (!host || host === CANONICAL_HOST) return null;

  const url = new URL(request.url);
  url.host = CANONICAL_HOST;
  url.protocol = "https:";
  url.port = "";
  // 308: the method and body survive, so a form posted to the old host is not
  // silently turned into a GET and lost.
  return NextResponse.redirect(url, 308);
}

export async function proxy(request: NextRequest) {
  const redirect = canonicalRedirect(request);
  if (redirect) return redirect;

  if (!getAuth0()) {
    return NextResponse.next();
  }
  return auth0.middleware(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
