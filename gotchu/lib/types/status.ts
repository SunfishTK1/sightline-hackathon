/** @owner Will — status union + legal transitions (spec §4) */
export type TaskStatus =
  | "DRAFT"
  | "ETHICS_REVIEW"
  | "BLOCKED"
  | "OPEN"
  | "MATCHING"
  | "NEGOTIATING"
  | "PENDING_APPROVAL"
  | "NO_MATCH"
  | "ACCEPTED"
  | "DECLINED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "REVIEWED";

/** Legal edges from the state machine. Validate before every status write. */
export const LEGAL_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  DRAFT: ["ETHICS_REVIEW"],
  ETHICS_REVIEW: ["BLOCKED", "OPEN"],
  BLOCKED: ["DRAFT"],
  OPEN: ["MATCHING"],
  MATCHING: ["NEGOTIATING", "NO_MATCH"],
  NEGOTIATING: ["PENDING_APPROVAL", "NO_MATCH", "MATCHING"],
  PENDING_APPROVAL: ["ACCEPTED", "DECLINED"],
  DECLINED: ["OPEN"],
  NO_MATCH: ["OPEN", "MATCHING"],
  ACCEPTED: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["REVIEWED"],
  REVIEWED: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}
