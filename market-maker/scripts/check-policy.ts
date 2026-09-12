import { evaluateWorkerResponse } from "../src/lib/market/evaluate-response";
import type { Task, WorkerResponse } from "../src/lib/market/types";

const deadline = new Date("2026-09-12T18:00:00-04:00");

const task = {
  pricing: {
    currentOfferUsd: 10,
    agentMayIncreaseToUsd: 10,
    maximumUsd: 16,
  },
  structured: { deadline },
} as Task;

const cases: Array<[string, WorkerResponse, string]> = [
  ["decline", { decision: "DECLINE", confidence: 1 }, "TRY_NEXT_CANDIDATE"],
  [
    "accept at offer",
    { decision: "ACCEPT", priceUsd: 10, estimatedCompletionAt: deadline, confidence: 1 },
    "PROPOSE_FINAL_AGREEMENT",
  ],
  [
    "counter 12 inside max",
    { decision: "COUNTER", priceUsd: 12, estimatedCompletionAt: deadline, confidence: 1 },
    "ASK_REQUESTER",
  ],
  [
    "counter 20 over max",
    { decision: "COUNTER", priceUsd: 20, estimatedCompletionAt: deadline, confidence: 1 },
    "TRY_RELAXATION_OR_NEXT_CANDIDATE",
  ],
];

let failed = 0;
for (const [name, response, expected] of cases) {
  const result = evaluateWorkerResponse(task, response);
  if (result.action !== expected) {
    console.error(`FAIL ${name}: expected ${expected}, got ${result.action}`);
    failed += 1;
  } else {
    console.log(`ok  ${name} → ${result.action}`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
