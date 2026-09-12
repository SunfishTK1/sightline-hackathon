const DATE_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "deadline",
  "until",
  "sentAt",
  "expiresAt",
  "receivedAt",
  "reviewedAt",
  "earliestStartAt",
  "availableAt",
  "estimatedCompletionAt",
  "requesterApprovedAt",
  "workerApprovedAt",
]);

export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item instanceof Date ? item.toISOString() : item,
  );
}

export function fromJson<T>(value: unknown): T {
  return reviveDates(value) as T;
}

function reviveDates(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reviveDates);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => {
        if (
          DATE_KEYS.has(key) &&
          typeof item === "string" &&
          !Number.isNaN(Date.parse(item))
        ) {
          return [key, new Date(item)];
        }
        return [key, reviveDates(item)];
      },
    );
    return Object.fromEntries(entries);
  }
  return value;
}
