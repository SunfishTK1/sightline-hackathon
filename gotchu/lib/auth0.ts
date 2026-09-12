/**
 * The Auth0 client. Configuration comes from the environment -
 * AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET and
 * APP_BASE_URL - which the SDK reads itself.
 *
 * The SDK mounts its own routes at /auth/login, /auth/logout, /auth/callback
 * and /auth/profile. They exist only while the proxy runs, so the matcher in
 * proxy.ts has to stay broad.
 */
import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client();

/** Whether login is configured at all, so pages can say so instead of erroring. */
export const authConfigured = Boolean(
  process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_SECRET,
);
