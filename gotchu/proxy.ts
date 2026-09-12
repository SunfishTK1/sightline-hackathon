/**
 * Next 16 replaced middleware.ts with proxy.ts. Auth0's routes - /auth/login,
 * /auth/callback, /auth/logout, /auth/profile - exist only because this runs,
 * and rolling sessions are refreshed on the pass-through branch, so the matcher
 * has to stay broad rather than listing protected pages.
 *
 * This does not itself refuse anyone: pages decide that, so the ethics endpoints
 * stay reachable for the services that call them.
 */
import { auth0 } from "./lib/auth0";

export async function proxy(request: Request) {
  return await auth0.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
