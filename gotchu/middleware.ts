/**
 * @owner Will
 * @shared true — message team before changing
 *
 * Auth0 session middleware. Protects authenticated routes.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(_request: NextRequest) {
  // TODO(Will): wire @auth0/nextjs-auth0 middleware
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/onboarding",
    "/compose",
    "/feed",
    "/tasks/:path*",
    "/api/((?!auth).*)",
  ],
};
