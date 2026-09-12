import { reliabilityScore } from "./score-candidate";
import type { User } from "./types";

export function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function asNumber(
  value: string | number | null | undefined,
): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Median paid for this category, nudged by worker reliability. */
export function categoryFloor(
  comps: number[],
  reliability: number,
): number {
  if (comps.length === 0) return 0;
  const sorted = [...comps].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return money(median * (0.85 + 0.15 * reliability));
}

export function clearingPrice(input: {
  requesterMax: number;
  workerMin: number;
  workerPreferred?: number;
  categoryFloor: number;
}): { offerUsd: number; overlap: boolean } {
  const low = Math.max(input.workerMin, input.categoryFloor);
  const high = input.requesterMax;
  if (low > high) {
    return { offerUsd: money(high), overlap: false };
  }
  const preferred = input.workerPreferred;
  if (preferred != null && preferred >= low && preferred <= high) {
    return { offerUsd: money(preferred), overlap: true };
  }
  return { offerUsd: money(low), overlap: true };
}

export function quoteForWorker(input: {
  requesterMax: number;
  worker: User;
  comps: number[];
}): { offerUsd: number; overlap: boolean; floor: number } {
  const reliability = reliabilityScore(input.worker);
  const floor = categoryFloor(input.comps, reliability);
  const quoted = clearingPrice({
    requesterMax: input.requesterMax,
    workerMin: input.worker.workerProfile.minPriceUsd ?? 0,
    workerPreferred: input.worker.workerProfile.preferredPriceUsd,
    categoryFloor: floor,
  });
  return { ...quoted, floor };
}
