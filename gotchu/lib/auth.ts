/**
 * @owner Will
 * Session → user helpers. Never trust a uuid from the client body.
 */
import type { User } from "./types/user";

export async function requireUser(): Promise<User> {
  // TODO(Will): resolve Auth0 session → auth0Sub → users collection
  throw new Error("requireUser() not implemented — Will wires Auth0 at T+2");
}

export async function getOptionalUser(): Promise<User | null> {
  try {
    return await requireUser();
  } catch {
    return null;
  }
}
