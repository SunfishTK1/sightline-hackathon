import { listSimilarComps } from "@/lib/db/comps";
import { listBusyWorkerUuids, listPaidCompsByCategory } from "@/lib/db/tasks";
import { normalizePhone } from "@/lib/phone";
import { requesterBudget, requesterMaximum, taskFromBrokerOrder } from "./broker-order";
import { upsertBrokerWorker } from "./broker-users";
import {
  effortPremium,
  estimateJobTravel,
  recommendedMinutes,
  serializeTravel,
  type SerializedTravel,
} from "./campus-travel";
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
  pDeal: number;
  pWorker: number;
  pRequester: number;
  askTime: boolean;
}

export interface BrokerSkip {
  phone: string;
  reason: string;
}

export interface BrokerQuoteResult {
  suggestedOfferUsd: number;
  maximumUsd: number;
  travel: SerializedTravel;
  picks: BrokerPick[];
  skip: BrokerSkip[];
}

function emptyTravel(order: BrokerOrderInput): SerializedTravel {
  return serializeTravel(
    estimateJobTravel({
      pickup: order.pickup_location,
      dropoff: order.dropoff_location,
      category: order.category,
      deadlineAt: order.deadline_at,
    }),
  );
}

export async function quoteBrokerOrder(input: {
  order: BrokerOrderInput;
  candidates: BrokerCandidateInput[];
}): Promise<BrokerQuoteResult> {
  const travel = estimateJobTravel({
    pickup: input.order.pickup_location,
    dropoff: input.order.dropoff_location,
    category: input.order.category,
    deadlineAt: input.order.deadline_at,
  });
  const serialized = serializeTravel(travel);

  const ethics = reviewBrokerAction({
    title: input.order.title,
    details: input.order.details ?? undefined,
  });
  if (!ethics.allowed) {
    return {
      suggestedOfferUsd: requesterBudget(input.order),
      maximumUsd: requesterMaximum(input.order),
      travel: serialized,
      picks: [],
      skip: input.candidates.map((candidate) => ({
        phone: candidate.phone,
        reason: ethics.reasons[0] ?? "Blocked by ethics",
      })),
    };
  }

  const budgetUsd = requesterBudget(input.order);
  const maximumUsd = requesterMaximum(input.order);
  const category = mapCategory(input.order.category);
  const similar = await listSimilarComps({
    category,
    distanceM: travel.distanceM,
    durationMin: travel.totalMin,
  });
  const history = await listPaidCompsByCategory(category);
  const comps = [...(input.order.comps ?? []), ...similar, ...history];
  const busy = await listBusyWorkerUuids(input.order.id ?? "broker-none");
  const requesterPhone = input.order.requester_phone
    ? normalizePhone(input.order.requester_phone)
    : "";
  const effortFloor = effortPremium(travel.distanceM, travel.totalMin);
  const hopMin = recommendedMinutes(travel);
  const askTime = travel.feasibility !== "OK";

  const ranked: BrokerPick[] = [];
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

    const maxTravel = worker.workerProfile.maxTravelMinutes;
    if (maxTravel != null && hopMin > maxTravel) {
      skip.push({
        phone,
        reason: `${hopMin} min ${travel.recommended} exceeds their ${maxTravel} min travel cap`,
      });
      continue;
    }

    const quoted = quoteForWorker({
      requesterMax: maximumUsd,
      requesterBudget: budgetUsd,
      worker,
      comps,
      effortFloor,
    });
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
    const closePct = Math.round(quoted.pDeal * 100);
    const timeNote =
      travel.feasibility === "INFEASIBLE"
        ? "; deadline looks short for this hop"
        : travel.feasibility === "TIGHT"
          ? "; tight on time"
          : "";
    const timeWeight =
      travel.feasibility === "INFEASIBLE" ? 0.45 : travel.feasibility === "TIGHT" ? 0.75 : 1;
    ranked.push({
      phone,
      reason: `${reasons[0] ?? "Fit for this job"}; $${quoted.offerUsd} (~${closePct}% both sides say yes); ${travel.line}${timeNote}`,
      offerUsd: quoted.offerUsd,
      score: scores.final * (0.6 + 0.4 * quoted.pDeal) * timeWeight,
      pDeal: quoted.pDeal,
      pWorker: quoted.pWorker,
      pRequester: quoted.pRequester,
      askTime,
    });
  }

  ranked.sort((left, right) => right.score - left.score);
  const suggestedOfferUsd =
    ranked[0]?.offerUsd ?? (maximumUsd > 0 ? money(maximumUsd) : 0);

  return { suggestedOfferUsd, maximumUsd, travel: serialized, picks: ranked, skip };
}
