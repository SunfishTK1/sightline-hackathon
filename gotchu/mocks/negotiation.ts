/** @owner Daphne — scripted concession ladder for offline build */
import type { Offer } from "@/lib/types/offer";

export function mockNextMove(round: number, role: "worker_agent" | "requester_agent") {
  const ladder = [
    { worker: 14, requester: 9 },
    { worker: 11, requester: 11 },
    { worker: 11, requester: 11 },
  ];
  const prices = ladder[Math.min(round - 1, ladder.length - 1)];
  const priceUsd = role === "worker_agent" ? prices.worker : prices.requester;
  const accept = round >= 2 && role === "requester_agent" && priceUsd === 11;

  return {
    round,
    from: role,
    priceUsd,
    etaMinutes: role === "worker_agent" ? 20 + round : 25,
    rationale:
      role === "worker_agent"
        ? `Can do it for $${priceUsd} given the walk.`
        : `Counter at $${priceUsd} — within budget.`,
    accept,
    at: new Date().toISOString(),
  };
}

export const MOCK_NEGOTIATION_OFFER: Offer = {
  taskId: "tsk_mock",
  workerUuid: "usr_mock_01",
  matchScore: 0.91,
  transcript: [
    mockNextMove(1, "worker_agent"),
    mockNextMove(1, "requester_agent"),
    mockNextMove(2, "worker_agent"),
    { ...mockNextMove(2, "requester_agent"), accept: true, priceUsd: 11 },
  ],
  outcome: "AGREED",
  finalPriceUsd: 11,
  createdAt: new Date().toISOString(),
};
