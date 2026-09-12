import { clearingPrice, categoryFloor } from "../src/lib/market/quote-price";
import { evaluateBrokerDecision } from "../src/lib/market/evaluate-broker";
import { looksLikeScopeChange } from "../src/lib/market/scope-change";
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

const auto = evaluateBrokerDecision({
  order: { title: "Fridge move", budget_usd: 15, category: "moving" },
  current_offer_usd: 10,
  decision: "AUTO_WORKER",
  worker_min_usd: 12,
});
check("auto worker counters at min", auto.action === "COUNTER" && auto.nextOfferUsd === 12);

const accept = evaluateBrokerDecision({
  order: { title: "Fridge move", budget_usd: 15 },
  current_offer_usd: 12,
  decision: "AUTO_REQUESTER",
  price_usd: 12,
});
check("auto requester accepts at quote", accept.action === "ACCEPT");

const ask = evaluateBrokerDecision({
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
  { roundsUsed: 3 },
);
check("round cap", rounds.action === "TRY_NEXT_CANDIDATE");

if (failed > 0) process.exitCode = 1;
