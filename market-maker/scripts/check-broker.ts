import {
  clearingPrice,
  categoryFloor,
  primePrice,
} from "../src/lib/market/quote-price";
import { estimateJobTravel, estimateTravel } from "../src/lib/market/campus-travel";
import { evaluateBrokerDecision } from "../src/lib/market/evaluate-broker";
import {
  arbitrationBlocksDeal,
  ethicsStructuredFromOrder,
} from "../src/lib/market/ethics-gate";
import { looksLikeScopeChange } from "../src/lib/market/scope-change";
import { looksLikeTimeAsk } from "../src/lib/market/time-ask";
import { evaluateWorkerResponse } from "../src/lib/market/evaluate-response";
import type { Task } from "../src/lib/market/types";

const deadline = new Date("2026-09-12T18:00:00-04:00");
const task = {
  pricing: {
    currentOfferUsd: 10,
    agentMayIncreaseToUsd: 10,
    maximumUsd: 16,
  },
  structured: { deadline },
} as Task;

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`ok  ${name}`);
  else {
    console.error(`FAIL ${name}`);
    failed += 1;
  }
}

async function main() {
check("floor median", categoryFloor([8, 10, 12], 1) === 10);
check(
  "clearing overlap at min",
  clearingPrice({ requesterMax: 15, workerMin: 12, categoryFloor: 0 }).offerUsd === 12 &&
    clearingPrice({ requesterMax: 15, workerMin: 12, categoryFloor: 0 }).overlap,
);
check(
  "no overlap",
  !clearingPrice({ requesterMax: 10, workerMin: 18, categoryFloor: 0 }).overlap,
);

const auto = await evaluateBrokerDecision({
  order: { title: "Fridge move", budget_usd: 15, category: "moving" },
  current_offer_usd: 10,
  decision: "AUTO_WORKER",
  worker_min_usd: 12,
});
check(
  "auto worker counters inside overlap",
  auto.action === "COUNTER" &&
    (auto.nextOfferUsd ?? 0) >= 12 &&
    (auto.nextOfferUsd ?? 0) <= 15,
);

const primed = primePrice({
  requesterBudget: 15,
  requesterMax: 15,
  workerMin: 12,
  workerPreferred: 14,
  reliability: 0.7,
  comps: [13, 14, 14],
});
check(
  "prime is not the worker floor",
  primed.overlap && primed.offerUsd > 12 && primed.offerUsd <= 15 && primed.pDeal > 0,
);
check("prime beats floor close-rate", primed.pDeal > 0.25);

const accept = await evaluateBrokerDecision({
  order: { title: "Fridge move", budget_usd: 15 },
  current_offer_usd: 12,
  decision: "AUTO_REQUESTER",
  price_usd: 12,
});
check("auto requester accepts at quote", accept.action === "ACCEPT");

const ask = await evaluateBrokerDecision({
  order: { title: "Fridge move", budget_usd: 15 },
  current_offer_usd: 10,
  decision: "AUTO_REQUESTER",
  price_usd: 14,
});
check("auto requester asks above quote", ask.action === "ASK_REQUESTER" && ask.askRequester);

check(
  "scope change",
  looksLikeScopeChange("I'll do it if you also bring five coffees or I will cancel"),
);

const rounds = evaluateWorkerResponse(
  task,
  { decision: "COUNTER", priceUsd: 12, estimatedCompletionAt: deadline, confidence: 1 },
  { roundsUsed: 2 },
);
check("round cap after 2 counters", rounds.action === "TRY_NEXT_CANDIDATE");

const timed = await evaluateBrokerDecision({
  order: { title: "Fridge move", budget_usd: 15 },
  current_offer_usd: 12,
  decision: "TIMEOUT",
});
check("timeout moves on", timed.action === "TRY_NEXT");

const ucGates = estimateTravel("UC", "Gates");
check("uc-gates is pinned", ucGates.known && ucGates.walkMin > 0 && ucGates.walkMin < 15);
check("uc-gates walk is recommended", ucGates.recommended === "walk");

const far = estimateTravel("Morewood", "Squirrel Hill");
check("squirrel hill prefers bus", far.known && far.recommended === "bus" && far.distanceM > 1500);

const tight = estimateJobTravel({
  pickup: "UC",
  dropoff: "Gates",
  category: "PACKAGE_PICKUP",
  deadlineAt: new Date(Date.now() + 5 * 60_000),
});
check("five minutes is infeasible for a pickup", tight.feasibility === "INFEASIBLE");

check("time ask note", looksLikeTimeAsk("I can do it but need 20 more min"));

const needTime = await evaluateBrokerDecision({
  order: {
    title: "Fridge move",
    budget_usd: 15,
    pickup_location: "Morewood",
    dropoff_location: "Donner",
    category: "moving",
  },
  current_offer_usd: 14,
  decision: "NEED_TIME",
  estimated_minutes: 40,
});
check(
  "need time asks requester",
  needTime.action === "ASK_REQUESTER" &&
    needTime.askRequester &&
    Boolean(needTime.suggestedDeadline),
);

const lateYes = await evaluateBrokerDecision({
  order: {
    title: "Fridge move",
    budget_usd: 15,
    deadline_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    pickup_location: "UC",
    dropoff_location: "Gates",
  },
  current_offer_usd: 12,
  decision: "ACCEPT",
  estimated_minutes: 90,
});
check("yes but late asks for time", lateYes.action === "ASK_REQUESTER" && lateYes.askRequester);

const packageJob = ethicsStructuredFromOrder({
  title: "Pick up my package at the UC",
  details: "Need pickup authorization",
  category: "pickup",
  budget_usd: 10,
});
check("package maps to ethics pickup", packageJob.category === "pickup");
check("food maps to ethics food", ethicsStructuredFromOrder({
  title: "Tepper food run",
  category: "food",
  budget_usd: 8,
}).category === "food");
check("reject and block stop the deal", arbitrationBlocksDeal("REJECT_MOVE") && arbitrationBlocksDeal("BLOCK_TASK"));
check("allow does not stop the deal", !arbitrationBlocksDeal("ALLOW"));

if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
