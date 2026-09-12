/**
 * @owner Will
 * Session → user. Never trust a uuid from the client body.
 */
import { getIdentity } from "./identity";
import { findUserByAuth0Sub } from "./users";
import type { User } from "./types/user";

export async function getOptionalUser(): Promise<User | null> {
  const identity = await getIdentity();
  if (!identity) return null;
  return findUserByAuth0Sub(identity.auth0Sub);
}

export async function requireUser(): Promise<User> {
  const user = await getOptionalUser();
  if (!user) {
    throw new Error("Complete onboarding first.");
  }
  return user;
}
