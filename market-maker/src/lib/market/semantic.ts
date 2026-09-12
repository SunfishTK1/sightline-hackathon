import type { Task, User } from "./types";
import { taskTextForEmbedding } from "./task-text";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "this",
  "that",
  "about",
  "someone",
  "need",
  "help",
  "can",
  "usually",
  "around",
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9$]+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

export function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / new Set([...left, ...right]).size;
}

export function cosineSimilarity(left: number[], right: number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  if (leftNorm === 0 || rightNorm === 0) return null;
  return (dot / Math.sqrt(leftNorm * rightNorm) + 1) / 2;
}

export function lexicalSemanticFit(task: Task, user: User): number {
  const taskTokens = tokenize(taskTextForEmbedding(task));
  const userTokens = tokenize(
    [
      user.preferenceText,
      ...user.workerProfile.categories,
      ...user.workerProfile.typicalLocations,
      user.workerProfile.availabilityText ?? "",
    ].join(" "),
  );
  const overlap = jaccard(taskTokens, userTokens);
  const categoryBonus = user.workerProfile.categories.includes(
    task.structured.category,
  )
    ? 1
    : 0;
  return clamp(0.35 * categoryBonus + 0.65 * overlap, 0, 1);
}

export function semanticFit(task: Task, user: User): number {
  const vector = cosineSimilarity(task.taskEmbedding, user.preferenceEmbedding);
  if (vector != null) return vector;
  return lexicalSemanticFit(task, user);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
