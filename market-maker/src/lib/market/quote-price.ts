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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function impliedPreferred(
  workerMin: number,
  categoryMedian: number,
): number {
  if (categoryMedian > workerMin) return money(categoryMedian);
  return money(Math.max(workerMin + 2, workerMin * 1.2));
}

/** Chance the worker says yes at this price. 0 under their min. */
export function pWorkerAccepts(
  price: number,
  input: { min: number; preferred: number; reliability: number },
): number {
  if (price < input.min) return 0;
  let fit = 1;
  if (price < input.preferred) {
    const span = Math.max(input.preferred - input.min, 1);
    fit = 0.35 + 0.65 * ((price - input.min) / span);
  }
  return clamp01(fit * (0.75 + 0.25 * input.reliability));
}

/**
 * Chance the requester says yes. High below their ask, fades as we spend
 * their whole budget, zero above their max.
 */
export function pRequesterAccepts(
  price: number,
  budget: number,
  maximum: number,
): number {
  const cap = maximum > 0 ? maximum : budget;
  const ask = budget > 0 ? budget : cap;
  if (cap <= 0 || price > cap) return 0;
  if (price <= ask * 0.7) return 0.95;
  const top = Math.max(ask, cap);
  const span = Math.max(top - ask * 0.7, 1);
  return clamp01(0.95 - 0.5 * ((price - ask * 0.7) / span));
}

export function pDealAtPrice(
  price: number,
  input: {
    workerMin: number;
    workerPreferred: number;
    reliability: number;
    requesterBudget: number;
    requesterMax: number;
  },
): { pDeal: number; pWorker: number; pRequester: number } {
  const pWorker = pWorkerAccepts(price, {
    min: input.workerMin,
    preferred: input.workerPreferred,
    reliability: input.reliability,
  });
  const pRequester = pRequesterAccepts(
    price,
    input.requesterBudget,
    input.requesterMax,
  );
  return { pDeal: money(pWorker * pRequester), pWorker: money(pWorker), pRequester: money(pRequester) };
}

/** Lowest feasible price — used when we only need a floor, not a close-rate prime. */
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

/**
 * Price that maximizes P(worker yes) * P(requester yes) inside the overlap.
 * This is what we suggest to both sides so the first text is closeable.
 */
export function primePrice(input: {
  requesterBudget: number;
  requesterMax: number;
  workerMin: number;
  workerPreferred?: number;
  reliability: number;
  comps: number[];
  effortFloor?: number;
}): {
  offerUsd: number;
  overlap: boolean;
  pDeal: number;
  pWorker: number;
  pRequester: number;
} {
  const high = input.requesterMax;
  const low = Math.max(input.workerMin, input.effortFloor ?? 0);
  const median = input.comps.length
    ? [...input.comps].sort((a, b) => a - b)[Math.floor(input.comps.length / 2)]
    : 0;
  const preferred =
    input.workerPreferred ?? impliedPreferred(input.workerMin, median ?? 0);

  if (low > high) {
    const atCap = pDealAtPrice(high, { ...input, workerPreferred: preferred });
    return { offerUsd: money(high), overlap: false, ...atCap };
  }

  let best = {
    offerUsd: money(low),
    overlap: true,
    ...pDealAtPrice(low, { ...input, workerPreferred: preferred }),
  };

  const start = Math.max(1, Math.ceil(low));
  const end = Math.max(start, Math.floor(high));
  for (let price = start; price <= end; price += 1) {
    const at = pDealAtPrice(price, { ...input, workerPreferred: preferred });
    const betterClose = at.pDeal > best.pDeal + 0.005;
    const sameCloseCheaper =
      Math.abs(at.pDeal - best.pDeal) <= 0.005 && price < best.offerUsd;
    if (betterClose || sameCloseCheaper) {
      best = { offerUsd: money(price), overlap: true, ...at };
    }
  }
  return best;
}

export function quoteForWorker(input: {
  requesterMax: number;
  requesterBudget?: number;
  worker: User;
  comps: number[];
  effortFloor?: number;
}): {
  offerUsd: number;
  overlap: boolean;
  floor: number;
  pDeal: number;
  pWorker: number;
  pRequester: number;
} {
  const reliability = reliabilityScore(input.worker);
  const floor = categoryFloor(input.comps, reliability);
  const workerMin = input.worker.workerProfile.minPriceUsd ?? 0;
  const primed = primePrice({
    requesterBudget: input.requesterBudget ?? input.requesterMax,
    requesterMax: input.requesterMax,
    workerMin,
    workerPreferred: input.worker.workerProfile.preferredPriceUsd,
    reliability,
    comps: input.comps,
    effortFloor: input.effortFloor,
  });
  return { ...primed, floor };
}
