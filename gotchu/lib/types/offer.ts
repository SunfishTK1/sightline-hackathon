/** @owner Daphne */
export type OfferOutcome = "PENDING" | "AGREED" | "FAILED" | "WITHDRAWN";

export type NegotiationRole = "worker_agent" | "requester_agent";

export interface NegotiationMessage {
  round: number;
  from: NegotiationRole;
  priceUsd: number;
  etaMinutes: number;
  rationale: string;
  accept: boolean;
  at: string; // ISO
}

export interface Offer {
  // offerId derived from Mongo _id or ofr_… — Daphne owns generation
  taskId: string; // 🔒
  workerUuid: string; // 🔒
  matchScore: number;
  transcript: NegotiationMessage[]; // 🔒
  outcome: OfferOutcome;
  finalPriceUsd?: number;
  createdAt: string;
}
