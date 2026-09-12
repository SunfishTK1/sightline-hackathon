import type {
  Agreement,
  CandidateScore,
  InboundSms,
  MatchingRun,
  NextAction,
  RelaxationOption,
  TaskCandidate,
} from "./types";

/**
 * Locked function contracts.
 *
 * You (matching / market policy): findCandidates, createMatchingRun,
 * selectOutreachBatch, buildRelaxationOptions.
 *
 * Daphne (communication / negotiation): sendCandidateInvitations,
 * handleInboundMessage, evaluateNegotiation, requestRequesterApproval,
 * finalizeAgreement.
 *
 * Do not change these signatures without updating both sides.
 */

export type FindCandidates = (taskId: string) => Promise<CandidateScore[]>;
export type CreateMatchingRun = (taskId: string) => Promise<MatchingRun>;
export type SelectOutreachBatch = (runId: string) => Promise<TaskCandidate[]>;
export type BuildRelaxationOptions = (
  taskId: string,
) => Promise<RelaxationOption[]>;

export type SendCandidateInvitations = (
  candidateIds: string[],
) => Promise<void>;
export type HandleInboundMessage = (message: InboundSms) => Promise<void>;
export type EvaluateNegotiation = (
  negotiationId: string,
) => Promise<NextAction>;
export type RequestRequesterApproval = (taskId: string) => Promise<void>;
export type FinalizeAgreement = (negotiationId: string) => Promise<Agreement>;

export type { NextAction };
