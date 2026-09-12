/**
 * Who is signed in, according to Auth0.
 *
 * This is deliberately separate from lib/auth.ts (which maps a session onto the
 * Mongo user document): everything here answers only "who is this person", and
 * the marketplace account itself lives in the voice-mcp service.
 *
 * The Auth0 subject is the key. It is read from the session on the server and
 * never accepted from a request body - a client that could name its own subject
 * could act as anyone.
 */
import { auth0 } from "./auth0";

export type Identity = {
  sub: string;
  email: string;
  name: string;
  emailVerified: boolean;
  /** CMU only, per the landing page. Checked here as well as in Auth0. */
  isCmu: boolean;
};

const CMU_EMAIL = /@(andrew\.)?cmu\.edu$/i;

export async function getIdentity(): Promise<Identity | null> {
  const session = await auth0.getSession().catch(() => null);
  const user = session?.user;
  if (!user?.sub) return null;

  const email = typeof user.email === "string" ? user.email : "";
  const name =
    (typeof user.name === "string" && user.name) ||
    [user.given_name, user.family_name].filter(Boolean).join(" ") ||
    email.split("@")[0] ||
    "";

  return {
    sub: user.sub,
    email,
    name,
    emailVerified: user.email_verified === true,
    isCmu: CMU_EMAIL.test(email),
  };
}
