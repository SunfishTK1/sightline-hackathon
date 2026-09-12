/**
 * @owner Will
 * Auth0 client — only constructed when env is present so local onboarding still runs.
 */
import { Auth0Client } from "@auth0/nextjs-auth0/server";

export function auth0Configured(): boolean {
  return Boolean(
    process.env.AUTH0_SECRET &&
      process.env.AUTH0_CLIENT_ID &&
      (process.env.AUTH0_DOMAIN || process.env.AUTH0_ISSUER_BASE_URL),
  );
}

export const auth0 = new Auth0Client();

export function getAuth0(): Auth0Client | null {
  if (!auth0Configured()) return null;
  return auth0;
}
