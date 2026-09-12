import { TASK_CATEGORIES, type TaskCategory } from "./types";

/** Map voice-mcp / free-text category onto the market-maker enum. */
export function mapCategory(raw?: string | null): TaskCategory {
  const value = (raw ?? "").trim();
  if (!value) return "OTHER";

  const upper = value.toUpperCase().replace(/[\s-]+/g, "_");
  if ((TASK_CATEGORIES as readonly string[]).includes(upper)) {
    return upper as TaskCategory;
  }

  const lower = value.toLowerCase();
  if (lower.includes("food") || lower.includes("coffee") || lower.includes("lunch")) {
    return "FOOD_RUN";
  }
  if (
    lower.includes("package") ||
    lower.includes("pickup") ||
    lower.includes("mail") ||
    lower.includes("parcel")
  ) {
    return "PACKAGE_PICKUP";
  }
  if (lower.includes("mov") || lower.includes("fridge") || lower.includes("furniture")) {
    return "MOVING";
  }
  if (lower.includes("tutor") || lower.includes("homework")) {
    return "TUTORING";
  }
  if (lower.includes("errand")) {
    return "CAMPUS_ERRAND";
  }
  return "OTHER";
}

export function mapWorkerCategories(raw?: string[] | null): TaskCategory[] {
  if (!raw?.length) return [];
  const mapped = raw.map(mapCategory);
  const onlyUnknown = mapped.every((category) => category === "OTHER");
  const namedOther = raw.some((value) => /other/i.test(value));
  if (onlyUnknown && !namedOther) return [];
  return [...new Set(mapped)];
}
