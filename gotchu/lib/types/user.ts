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

export interface User {
  uuid: string; // 🔒 usr_…
  auth0Sub: string; // 🔒
  firstName: string; // 🔒
  lastName: string; // 🔒
  cmuEmail: string; // 🔒
  phone: string; // 🔒 E.164
  preferenceText: string;
  preferenceEmbedding: number[]; // 768 dims (Gemini text-embedding-004)
  availability: UserAvailability;
  stats: UserStats;
  createdAt: string;
  updatedAt: string;
}
