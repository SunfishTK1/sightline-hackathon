/** @owner Will */
export interface UserStats {
  tasksCompleted: number;
  tasksRequested: number;
  avgRating: number | null;
  ratingCount: number;
}

export interface UserAvailability {
  isAvailable: boolean;
  until?: string; // ISO date
}

export interface UserConsents {
  age18: boolean;
  canCall: boolean;
  canText: boolean;
  acceptedTerms: boolean;
  /** Which TERMS_VERSION they agreed to - a stored acceptance only counts for that version. */
  termsVersion: string;
  acceptedAt: string;
}

export interface User {
  uuid: string; // 🔒 usr_…
  auth0Sub: string; // 🔒 Auth0 Management API user_id (or "local|<email>" when Auth0 isn't configured)
  firstName: string; // 🔒
  lastName: string; // 🔒
  cmuEmail: string; // 🔒
  phone: string; // 🔒 E.164
  emailVerified: boolean; // flips true once Auth0 reports the verification-email link was clicked
  emailVerifiedAt?: string;
  photoDataUrl?: string; // data: URI — future material for AI-generated animated avatars
  preferenceText: string;
  preferenceEmbedding: number[]; // 768 dims (Gemini text-embedding-004)
  consents: UserConsents;
  availability: UserAvailability;
  stats: UserStats;
  createdAt: string;
  updatedAt: string;
}
