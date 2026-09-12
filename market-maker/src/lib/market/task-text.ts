import type { Task } from "./types";

/** Embeddable task text only. No IDs, status, ethics boilerplate, or timestamps. */
export function taskTextForEmbedding(task: Task): string {
  const structured = task.structured;
  const details = structured.categoryDetails
    ? JSON.stringify(structured.categoryDetails)
    : "";

  return [
    structured.title,
    structured.description,
    structured.category.replaceAll("_", " ").toLowerCase(),
    structured.pickupLocation,
    structured.dropoffLocation,
    structured.meetingLocation,
    `about ${structured.estimatedMinutes} minutes`,
    `offering $${task.pricing.currentOfferUsd}`,
    ...structured.requirements,
    details,
  ]
    .filter(Boolean)
    .join(". ");
}
