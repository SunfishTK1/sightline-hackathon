/** @owner Will */
import type { TaskStatus } from "./status";
import type { EthicsVerdict } from "./ethics";

export type TaskCategory =
  | "pickup"
  | "food"
  | "moving"
  | "errand"
  | "tutoring_allowed"
  | "other";

export interface StructuredTask {
  title: string;
  category: TaskCategory;
  pickupLocation?: string;
  dropoffLocation?: string;
  deadline?: string; // ISO
  maxPriceUsd: number;
  estimatedMinutes?: number;
  requirements?: string[];
  inferred?: boolean;
  needsReview?: boolean;
}

export interface Task {
  taskId: string; // 🔒 tsk_…
  requesterUuid: string; // 🔒
  rawText: string;
  structured: StructuredTask; // 🔒
  taskEmbedding?: number[];
  ethics?: EthicsVerdict; // 🔒
  status: TaskStatus; // 🔒
  matchedWorkerUuid: string | null;
  agreedPriceUsd: number | null;
  createdAt: string;
  updatedAt: string;
}
