import { listBusyWorkerUuids, listPaidCompsByCategory } from "@/lib/db/tasks";
import { normalizePhone } from "@/lib/phone";
import { requesterBudget, requesterMaximum, taskFromBrokerOrder } from "./broker-order";
import { upsertBrokerWorker } from "./broker-users";
import { evaluateEligibility } from "./eligibility";
import { reviewBrokerAction } from "./ethics-gate";
import { explainScore, scoreCandidate } from "./score-candidate";
import { money, quoteForWorker } from "./quote-price";
import { mapCategory } from "./map-category";
import type { BrokerCandidateInput, BrokerOrderInput } from "./schemas";

export interface BrokerPick {
  phone: string;
  reason: string;
  offerUsd: number;
  score: number;
}

export interface BrokerSkip {
  phone: string;
  reason: string;
}

export interface BrokerQuoteResult {
  suggestedOfferUsd: number;
  maximumUsd: number;
  picks: BrokerPick[];
  skip: BrokerSkip[];
}

export async function quoteBrokerOrder(input: {
  order: BrokerOrderInput;
  candidates: BrokerCandidateInput[];
}): Promise<BrokerQuoteResult> {
  const ethics = reviewBrokerAction({
    title: input.order.title,
    details: input.order.details ?? undefined,
  });
  if (!ethics.allowed) {
    return {
      suggestedOfferUsd: requesterBudget(input.order),
      maximumUsd: requesterMaximum(input.order),
      picks: [],
      skip: input.candidates.map((candidate) => ({
        phone: candidate.phone,
        reason: ethics.reasons[0] ?? "Blocked by ethics",
      })),
    };
  }

  const maximumUsd = requesterMaximum(input.order);
  const category = mapCategory(input.order.category);
  const history = await listPaidCompsByCategory(category);
  const comps = [...(input.order.comps ?? []), ...history];
  const busy = await listBusyWorkerUuids(input.order.id ?? "broker-none");
  const requesterPhone = input.order.requester_phone
    ? normalizePhone(input.order.requester_phone)
    : "";

  const ranked: Array<BrokerPick & { skip?: never }> = [];
  const skip: BrokerSkip[] = [];

  for (const candidate of input.candidates) {
    const phone = normalizePhone(candidate.phone);
    if (requesterPhone && phone === requesterPhone) {
      skip.push({ phone, reason: "Requester cannot take their own job" });
      continue;
    }

    const worker = await upsertBrokerWorker(candidate);
    if (busy.has(worker.uuid)) {
      skip.push({ phone, reason: "Already on an accepted job" });
      continue;
    }

    const quoted = quoteForWorker({ requesterMax: maximumUsd, worker, comps });
    if (!quoted.overlap) {
      skip.push({
        phone,
        reason: `Min $${worker.workerProfile.minPriceUsd ?? 0} is above requester max $${maximumUsd}`,
      });
      continue;
    }

    const task = taskFromBrokerOrder(input.order, {
      offerUsd: quoted.offerUsd,
      maximumUsd,
      autoUsd: quoted.offerUsd,
    });
    const eligibility = evaluateEligibility(task, worker, { busyWorkerUuids: busy });
    const hardBlock = eligibility.reasons.filter(
      (reason) => reason !== "MIN_PRICE_ABOVE_AUTHORIZED",
    );
    if (hardBlock.length > 0) {
      skip.push({ phone, reason: hardBlock.join(", ") });
      continue;
    }

    const scores = scoreCandidate(task, worker);
    const reasons = explainScore(task, worker, scores);
    ranked.push({
      phone,
      reason: `${reasons[0] ?? "Fit for this job"}; market offer $${quoted.offerUsd}`,
      offerUsd: quoted.offerUsd,
      score: scores.final,
    });
  }

  ranked.sort((left, right) => right.score - left.score);
  const suggestedOfferUsd =
    ranked[0]?.offerUsd ?? (maximumUsd > 0 ? money(maximumUsd) : 0);

  return { suggestedOfferUsd, maximumUsd, picks: ranked, skip };
}
