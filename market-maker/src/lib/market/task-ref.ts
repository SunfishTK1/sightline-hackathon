import type { Task } from "./types";

export function taskRef(task: Task): string {
  const place = (
    task.structured.dropoffLocation ??
    task.structured.pickupLocation ??
    task.structured.category
  )
    .replaceAll(/[^a-z0-9]+/gi, "")
    .slice(0, 8)
    .toUpperCase();
  return place || task.taskId.slice(-6).toUpperCase();
}

export function taskMatchesReply(task: Task, rawText: string): boolean {
  const haystack = rawText.toLowerCase();
  const needles = [
    taskRef(task).toLowerCase(),
    task.structured.title.toLowerCase(),
    task.structured.category.toLowerCase().replaceAll("_", " "),
    task.structured.pickupLocation?.toLowerCase(),
    task.structured.dropoffLocation?.toLowerCase(),
    task.structured.categoryDetails && "itemDescription" in task.structured.categoryDetails
      ? task.structured.categoryDetails.itemDescription.toLowerCase()
      : undefined,
  ].filter((value): value is string => Boolean(value));

  return needles.some((needle) => haystack.includes(needle));
}
