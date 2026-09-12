import { estimateJobTravel } from "./campus-travel";
import { MAX_NEGOTIATION_ROUNDS } from "./constants";
import { requesterMaximum, taskFromBrokerOrder } from "./broker-order";
import { reviewBrokerAction } from "./ethics-gate";
import { evaluateWorkerResponse } from "./evaluate-response";
import { asNumber, money, quoteForWorker } from "./quote-price";
import { looksLikeScopeChange } from "./scope-change";
import { looksLikeTimeAsk, minutesFromTimeNote } from "./time-ask";
import type { BrokerEvaluateRequest } from "./schemas";
import type { User } from "./types";

export type BrokerEvaluateAction =
  | "ACCEPT"
  | "COUNTER"
  | "ASK_REQUESTER"
  | "TRY_NEXT"
  | "REJECT_SCOPE";

export interface BrokerEvaluateResult {
  action: BrokerEvaluateAction;
  agreedUsd?: number;
  nextOfferUsd?: number;
  messageHint: string;
  askRequester: boolean;
  suggestedDeadline?: string;
  neededMinutes?: number;
}

function blocked(): BrokerEvaluateResult {
  return {
    action: "TRY_NEXT",
    messageHint: "Ethics blocked this negotiation step.",
    askRequester: false,
  };
}

function stubWorker(minPriceUsd?: number): User {
  const now = new Date();
  return {
    uuid: "broker-eval-worker",
    auth0Sub: "broker|eval",
    firstName: "Worker",
    lastName: "Eval",
    cmuEmail: "broker.eval@gotchu.local",
    phone: "+10000000000",
    preferenceText: "",
    preferenceEmbedding: [],
    workerProfile: {
      enabled: true,
      categories: [],
      excludedCategories: [],
      typicalLocations: [],
      minPriceUsd,
      allowAgentAutoReject: false,
      allowAgentAutoAccept: false,
    },
    requesterProfile: { allowAutomaticCounters: true },
    stats: {
      tasksRequested: 0,
      tasksCompletedAsWorker: 0,
      requesterAvgRating: null,
      workerAvgRating: null,
      ratingCount: 0,
      acceptanceRate: null,
      completionRate: null,
    },
    availability: { isAvailable: true },
    createdAt: now,
    updatedAt: now,
  };
}

function fromPolicy(
  action: ReturnType<typeof evaluateWorkerResponse>["action"],
  priceUsd: number,
): BrokerEvaluateResult {
  if (action === "PROPOSE_FINAL_AGREEMENT") {
    return {
      action: "ACCEPT",
      agreedUsd: money(priceUsd),
      messageHint: `Agree at $${money(priceUsd)}.`,
      askRequester: false,
    };
  }
  if (action === "ASK_REQUESTER") {
    return {
      action: "ASK_REQUESTER",
      nextOfferUsd: money(priceUsd),
      messageHint: `Ask the requester about $${money(priceUsd)}.`,
      askRequester: true,
    };
  }
  return {
    action: "TRY_NEXT",
    messageHint: "Pass this worker and try the next candidate.",
    askRequester: false,
  };
}

export function evaluateBrokerDecision(
  input: BrokerEvaluateRequest,
): BrokerEvaluateResult {
  const ethics = reviewBrokerAction({
    title: input.order.title,
    details: input.order.details ?? undefined,
    note: input.note ?? undefined,
  });
  if (!ethics.allowed) return blocked();

  if (input.decision === "TIMEOUT") {
    return {
      action: "TRY_NEXT",
      messageHint: "No reply in time. Cancel this offer and ask the next worker.",
      askRequester: false,
    };
  }

  if (looksLikeScopeChange(input.note) && input.decision !== "DECLINE") {
    return {
      action: "REJECT_SCOPE",
      messageHint: "That counter changes the job. Do not forward it; try the next worker.",
      askRequester: false,
    };
  }

  const current = asNumber(input.current_offer_usd) ?? 0;
  const maximumUsd = requesterMaximum(input.order);
  const workerMin = asNumber(input.worker_min_usd) ?? 0;
  const autoUsd = current > 0 ? current : maximumUsd;
  const task = taskFromBrokerOrder(input.order, {
    offerUsd: current || autoUsd,
    maximumUsd,
    autoUsd,
  });

  if (input.decision === "REQUESTER_NO") {
    return {
      action: "TRY_NEXT",
      messageHint: "Requester passed. Try the next worker.",
      askRequester: false,
    };
  }
  if (input.decision === "REQUESTER_YES") {
    return {
      action: "ACCEPT",
      agreedUsd: money(current),
      messageHint: `Requester agreed at $${money(current)}.`,
      askRequester: false,
    };
  }
  if (input.decision === "DECLINE") {
    return {
      action: "TRY_NEXT",
      messageHint: "Worker declined. Try the next candidate.",
      askRequester: false,
    };
  }

  if (input.decision === "NEED_TIME" || looksLikeTimeAsk(input.note)) {
    return askForTime(input, current);
  }

  if (input.decision === "AUTO_WORKER") {
    if ((input.round ?? 0) >= MAX_NEGOTIATION_ROUNDS) {
      return {
        action: "TRY_NEXT",
        messageHint: "Two counters already. Move to the next worker.",
        askRequester: false,
      };
    }
    if (current >= workerMin && workerMin > 0) {
      return {
        action: "ACCEPT",
        agreedUsd: money(current),
        messageHint: `Offer $${money(current)} already clears their minimum.`,
        askRequester: false,
      };
    }
    const quoted = quoteForWorker({
      requesterMax: maximumUsd,
      requesterBudget: maximumUsd,
      worker: stubWorker(workerMin),
      comps: input.order.comps ?? [],
    });
    if (!quoted.overlap) {
      return {
        action: "TRY_NEXT",
        messageHint: `No overlap between min $${workerMin} and max $${maximumUsd}.`,
        askRequester: false,
      };
    }
    return {
      action: "COUNTER",
      nextOfferUsd: quoted.offerUsd,
      messageHint: `Counter at the suggested market price $${quoted.offerUsd}.`,
      askRequester: false,
    };
  }

  if (input.decision === "AUTO_REQUESTER") {
    const asking = asNumber(input.price_usd) ?? current;
    const policy = evaluateWorkerResponse(
      task,
      { decision: "COUNTER", priceUsd: asking, confidence: 1 },
      { roundsUsed: input.round, counterNote: input.note ?? undefined },
    );
    return fromPolicy(policy.action, asking);
  }

  const priceUsd =
    asNumber(input.price_usd) ??
    (input.decision === "ACCEPT" ? current : undefined);
  const estimatedCompletionAt = input.estimated_minutes
    ? new Date(Date.now() + input.estimated_minutes * 60_000)
    : undefined;
  const policy = evaluateWorkerResponse(
    task,
    {
      decision: input.decision === "COUNTER" ? "COUNTER" : "ACCEPT",
      priceUsd,
      estimatedCompletionAt,
      confidence: 1,
    },
    { roundsUsed: input.round, counterNote: input.note ?? undefined },
  );
  const result = fromPolicy(policy.action, priceUsd ?? current);
  if (policy.action === "ASK_REQUESTER" && policy.reason === "TIME_OUTSIDE_DEADLINE") {
    return { ...result, ...askForTime(input, priceUsd ?? current) };
  }
  return result;
}

function askForTime(
  input: BrokerEvaluateRequest,
  currentUsd: number,
): BrokerEvaluateResult {
  const travel = estimateJobTravel({
    pickup: input.order.pickup_location,
    dropoff: input.order.dropoff_location,
    category: input.order.category,
    deadlineAt: input.order.deadline_at,
  });
  const needed =
    input.estimated_minutes ??
    minutesFromTimeNote(input.note) ??
    travel.totalMin + 15;
  const suggested =
    travel.suggestedDeadline ?? new Date(Date.now() + needed * 60_000);
  return {
    action: "ASK_REQUESTER",
    nextOfferUsd: money(currentUsd),
    suggestedDeadline: suggested.toISOString(),
    neededMinutes: needed,
    messageHint: `Ask the requester for more time. Hop is ${travel.line}; typical completion ~${travel.totalMin} min. Suggest ${suggested.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}.`,
    askRequester: true,
  };
}
