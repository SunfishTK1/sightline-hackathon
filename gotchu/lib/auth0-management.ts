/**
 * @owner Will
 * Auth0 Management API — creates the (unverified) database-connection
 * user on submit and asks Auth0 to send its own verification email.
 * Requires a separate M2M application (Management API access), distinct
 * from the AUTH0_CLIENT_ID/SECRET used for the optional login flow.
 */
import { randomBytes } from "crypto";

const DEFAULT_CONNECTION = "Username-Password-Authentication";

type Auth0User = {
  user_id: string;
  email: string;
  email_verified: boolean;
};

type CachedToken = { token: string; expiresAt: number };
declare global {
  // eslint-disable-next-line no-var
  var _gotchuAuth0MgmtToken: CachedToken | undefined;
}

export function auth0ManagementConfigured(): boolean {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
      process.env.AUTH0_M2M_CLIENT_ID &&
      process.env.AUTH0_M2M_CLIENT_SECRET &&
      process.env.AUTH0_CLIENT_ID,
  );
}

function domain(): string {
  return process.env.AUTH0_DOMAIN!.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function getManagementToken(): Promise<string> {
  const cached = global._gotchuAuth0MgmtToken;
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const res = await fetch(`https://${domain()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.AUTH0_M2M_CLIENT_ID,
      client_secret: process.env.AUTH0_M2M_CLIENT_SECRET,
      audience: `https://${domain()}/api/v2/`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Auth0 Management token request failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  global._gotchuAuth0MgmtToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

async function managementFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getManagementToken();
  return fetch(`https://${domain()}/api/v2${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

async function findAuth0UserByEmail(email: string): Promise<Auth0User | null> {
  const res = await managementFetch(`/users-by-email?email=${encodeURIComponent(email)}`);
  if (!res.ok) {
    throw new Error(`Auth0 users-by-email lookup failed: ${res.status} ${await res.text()}`);
  }
  const users = (await res.json()) as Auth0User[];
  const connection = process.env.AUTH0_DB_CONNECTION ?? DEFAULT_CONNECTION;
  return users.find((u) => u.user_id.startsWith(`${connectionStrategy(connection)}|`)) ?? users[0] ?? null;
}

// Database-connection user_ids are minted as "auth0|<id>" regardless of the
// connection's display name, so match on strategy rather than name.
function connectionStrategy(_connection: string): string {
  return "auth0";
}

async function createAuth0User(email: string): Promise<Auth0User> {
  const res = await managementFetch("/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      email_verified: false,
      verify_email: false,
      connection: process.env.AUTH0_DB_CONNECTION ?? DEFAULT_CONNECTION,
      password: randomBytes(24).toString("base64url"),
    }),
  });
  if (!res.ok) {
    throw new Error(`Auth0 create user failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<Auth0User>;
}

export async function findOrCreateAuth0User(email: string): Promise<Auth0User> {
  const existing = await findAuth0UserByEmail(email);
  if (existing) return existing;
  return createAuth0User(email);
}

/**
 * Every onboarding submission — not just the first — re-demands email
 * confirmation. If Auth0 already has this user marked verified from a
 * prior click, flip it back to unverified first so the next status
 * check (and the email we're about to send) reflect that.
 */
export async function setAuth0EmailUnverified(userId: string): Promise<void> {
  const res = await managementFetch(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ email_verified: false }),
  });
  if (!res.ok) {
    throw new Error(`Auth0 set email unverified failed: ${res.status} ${await res.text()}`);
  }
}

export async function sendAuth0VerificationEmail(userId: string): Promise<void> {
  const res = await managementFetch("/jobs/verification-email", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      client_id: process.env.AUTH0_CLIENT_ID,
    }),
  });
  if (!res.ok) {
    throw new Error(`Auth0 send verification email failed: ${res.status} ${await res.text()}`);
  }
}

export async function isAuth0UserVerified(userId: string): Promise<boolean> {
  const res = await managementFetch(`/users/${encodeURIComponent(userId)}`);
  if (!res.ok) {
    if (res.status === 404) return false;
    throw new Error(`Auth0 get user failed: ${res.status} ${await res.text()}`);
  }
  const user = (await res.json()) as Auth0User;
  return Boolean(user.email_verified);
}
