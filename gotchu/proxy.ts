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

export async function proxy(request: NextRequest) {
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
