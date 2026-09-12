export const TASK_CATEGORIES = [
  "FOOD_RUN",
  "PACKAGE_PICKUP",
  "CAMPUS_ERRAND",
  "MOVING",
  "TUTORING",
  "OTHER",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_STATUSES = [
  "OPEN",
  "MATCHING",
  "CONTACTING_CANDIDATES",
  "WAITING_FOR_WORKERS",
  "EVALUATING_RESPONSES",
  "WAITING_FOR_REQUESTER",
  "RELAXATION_PROPOSED",
  "REMATCHING",
  "PENDING_BOTH_APPROVALS",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
  "NO_MATCH",
  "CANCELLED",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CANDIDATE_STATUSES = [
  "SHORTLISTED",
  "CONTACTED",
  "INTERESTED",
  "DECLINED",
  "TIMED_OUT",
  "INCOMPATIBLE",
  "SELECTED",
] as const;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const INVITATION_STATUSES = [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "RESPONDED",
  "EXPIRED",
  "CANCELLED",
] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const WORKER_DECISIONS = ["ACCEPT", "DECLINE", "COUNTER"] as const;
export type WorkerDecision = (typeof WORKER_DECISIONS)[number];

export const NEGOTIATION_STATES = [
  "WAITING_FOR_WORKER",
  "EVALUATING_WORKER_RESPONSE",
  "WAITING_FOR_REQUESTER",
  "READY_FOR_APPROVAL",
  "AGREED",
  "FAILED",
  "EXPIRED",
] as const;

export type NegotiationState = (typeof NEGOTIATION_STATES)[number];

export const NEGOTIATION_EVENT_TYPES = [
  "OFFER_SENT",
  "WORKER_ACCEPTED",
  "WORKER_DECLINED",
  "WORKER_COUNTERED",
  "REQUESTER_CHANGE_REQUESTED",
  "REQUESTER_APPROVED",
  "REQUESTER_REJECTED",
  "SYSTEM_EXPIRED",
] as const;

export type NegotiationEventType = (typeof NEGOTIATION_EVENT_TYPES)[number];

export const ACTORS = [
  "USER",
  "PERSONAL_AGENT",
  "MARKET_AGENT",
  "ETHICS_AGENT",
] as const;

export type Actor = (typeof ACTORS)[number];

export const NEGOTIATION_ACTORS = [
  "MARKET_AGENT",
  "REQUESTER",
  "WORKER",
] as const;

export type NegotiationActor = (typeof NEGOTIATION_ACTORS)[number];

export const MESSAGE_PURPOSES = [
  "WORKER_INVITATION",
  "WORKER_COUNTER",
  "REQUESTER_RELAXATION",
  "FINAL_APPROVAL",
  "STATUS_UPDATE",
] as const;

export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

export const MESSAGE_STATUSES = [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "FAILED",
  "RECEIVED",
] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const RELAXATION_STEP_STATUSES = [
  "UNTRIED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
] as const;

export type RelaxationStepStatus = (typeof RELAXATION_STEP_STATUSES)[number];

export const MATCHING_RUN_STATUSES = [
  "CREATED",
  "OUTREACH",
  "WAITING",
  "COMPLETED",
  "FAILED",
] as const;

export type MatchingRunStatus = (typeof MATCHING_RUN_STATUSES)[number];

export interface AutoAcceptRules {
  minPriceUsd: number;
  maxEstimatedMinutes: number;
  categories: TaskCategory[];
}

export interface WorkerProfile {
  enabled: boolean;
  categories: TaskCategory[];
  excludedCategories: TaskCategory[];
  typicalLocations: string[];
  availabilityText?: string;
  minPriceUsd?: number;
  preferredPriceUsd?: number;
  maxTravelMinutes?: number;
  allowAgentAutoReject: boolean;
  allowAgentAutoAccept: boolean;
  autoAcceptRules?: AutoAcceptRules;
}

export interface RequesterProfile {
  defaultMaxPriceUsd?: number;
  allowAutomaticCounters: boolean;
  maxAutomaticPriceIncreaseUsd?: number;
  maxAutomaticDeadlineExtensionMinutes?: number;
}

export interface UserStats {
  tasksRequested: number;
  tasksCompletedAsWorker: number;
  requesterAvgRating: number | null;
  workerAvgRating: number | null;
  ratingCount: number;
  acceptanceRate: number | null;
  completionRate: number | null;
}

export interface UserAvailability {
  isAvailable: boolean;
  until?: Date;
}

export interface User {
  uuid: string;
  auth0Sub: string;
  firstName: string;
  lastName: string;
  cmuEmail: string;
  phone: string;
  preferenceText: string;
  preferenceEmbedding: number[];
  workerProfile: WorkerProfile;
  requesterProfile: RequesterProfile;
  stats: UserStats;
  availability: UserAvailability;
  createdAt: Date;
  updatedAt: Date;
}

export interface EthicsVerdict {
  allowed: boolean;
  risk: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
  reviewedAt?: Date;
}

export interface FoodRunDetails {
  kind: "FOOD_RUN";
  vendor: string;
  pickupLocation: string;
  dropoffLocation: string;
  orderSummary?: string;
  dietaryNotes?: string;
  needsPaymentOnPickup: boolean;
}

export interface PackagePickupDetails {
  kind: "PACKAGE_PICKUP";
  pickupLocation: string;
  dropoffLocation: string;
  carrier?: string;
  trackingHint?: string;
  requiresAuthorization: boolean;
  packageSize?: "SMALL" | "MEDIUM" | "LARGE";
}

export interface CampusErrandDetails {
  kind: "CAMPUS_ERRAND";
  stops: string[];
  errandSummary: string;
}

export interface MovingDetails {
  kind: "MOVING";
  pickupLocation: string;
  dropoffLocation: string;
  itemDescription: string;
  approximateWeightLbs?: number;
  stairsOrElevator?: "STAIRS" | "ELEVATOR" | "UNKNOWN";
  helpersNeeded: number;
}

export interface TutoringDetails {
  kind: "TUTORING";
  courseCode?: string;
  subject: string;
  meetingLocation: string;
  sessionMinutes: number;
}

export interface OtherTaskDetails {
  kind: "OTHER";
  summary: string;
  location?: string;
}

export type CategoryDetails =
  | FoodRunDetails
  | PackagePickupDetails
  | CampusErrandDetails
  | MovingDetails
  | TutoringDetails
  | OtherTaskDetails;

export interface TaskStructured {
  title: string;
  description: string;
  category: TaskCategory;
  pickupLocation?: string;
  dropoffLocation?: string;
  meetingLocation?: string;
  earliestStartAt?: Date;
  deadline: Date;
  estimatedMinutes: number;
  requirements: string[];
  categoryDetails?: CategoryDetails;
}

export interface TaskPricing {
  initialOfferUsd: number;
  maximumUsd: number;
  agentMayIncreaseToUsd: number;
  agentMayExtendDeadlineTo?: Date;
  currentOfferUsd: number;
  currency: "USD";
}

export interface RelaxationStep {
  step: number;
  deadline: Date;
  proposedPriceUsd: number;
  requiresRequesterApproval: boolean;
  status: RelaxationStepStatus;
}

export interface Task {
  taskId: string;
  requesterUuid: string;
  rawText: string;
  structured: TaskStructured;
  pricing: TaskPricing;
  relaxationPlan: RelaxationStep[];
  ethics: EthicsVerdict;
  taskEmbedding: number[];
  status: TaskStatus;
  activeMatchingRunId?: string;
  matchedWorkerUuid?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CandidateScores {
  vector: number;
  priceFit: number;
  availability: number;
  reliability: number;
  experience: number;
  location: number;
  final: number;
}

export interface CandidateInvitation {
  status: InvitationStatus;
  sentAt?: Date;
  expiresAt?: Date;
}

export interface CandidateResponse {
  decision?: WorkerDecision;
  priceUsd?: number;
  availableAt?: Date;
  estimatedCompletionAt?: Date;
  rawText?: string;
  receivedAt?: Date;
}

export interface TaskCandidate {
  candidateId: string;
  taskId: string;
  workerUuid: string;
  matchingRunId: string;
  rank: number;
  scores: CandidateScores;
  reasons: string[];
  invitation: CandidateInvitation;
  response: CandidateResponse;
  status: CandidateStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NegotiationTerms {
  priceUsd: number;
  deadline: Date;
  workerAvailableAt?: Date;
}

export interface NegotiationEvent {
  eventId: string;
  type: NegotiationEventType;
  actor: NegotiationActor;
  terms?: {
    priceUsd: number;
    deadline: Date;
  };
  text?: string;
  createdAt: Date;
}

export interface Negotiation {
  negotiationId: string;
  taskId: string;
  candidateId: string;
  requesterUuid: string;
  workerUuid: string;
  state: NegotiationState;
  currentTerms: NegotiationTerms;
  roundsUsed: number;
  maxRounds: number;
  events: NegotiationEvent[];
  requesterApprovedAt?: Date;
  workerApprovedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  messageId: string;
  provider: "IMESSAGE" | "TWILIO";
  providerMessageId?: string;
  userUuid: string;
  taskId?: string;
  negotiationId?: string;
  direction: "OUTBOUND" | "INBOUND";
  purpose: MessagePurpose;
  body: string;
  status: MessageStatus;
  createdAt: Date;
}

export interface TaskEvent {
  eventId: string;
  taskId: string;
  type: string;
  actor: Actor;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface Review {
  reviewId: string;
  taskId: string;
  raterUuid: string;
  rateeUuid: string;
  role: "REQUESTER" | "WORKER";
  rating: number;
  comment?: string;
  createdAt: Date;
}

export interface MatchingRun {
  matchingRunId: string;
  taskId: string;
  attempt: number;
  terms: {
    priceUsd: number;
    deadline: Date;
  };
  candidateIds: string[];
  status: MatchingRunStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Agreement {
  agreementId: string;
  taskId: string;
  negotiationId: string;
  requesterUuid: string;
  workerUuid: string;
  terms: {
    priceUsd: number;
    deadline: Date;
  };
  createdAt: Date;
}

export interface CandidateScore {
  workerUuid: string;
  rank: number;
  scores: CandidateScores;
  reasons: string[];
}

export interface RelaxationOption {
  step: number;
  label: string;
  deadline: Date;
  proposedPriceUsd: number;
  requiresRequesterApproval: boolean;
}

export interface WorkerResponse {
  decision: WorkerDecision;
  priceUsd?: number;
  availableAt?: Date;
  estimatedCompletionAt?: Date;
  rawText?: string;
  confidence: number;
}

export interface ParsedTask {
  title: string;
  description: string;
  category: TaskCategory;
  pickupLocation?: string;
  dropoffLocation?: string;
  earliestStartAt?: Date;
  deadline: Date;
  estimatedMinutes: number;
  requirements: string[];
  initialOfferUsd: number;
  maximumUsd: number;
  confidence: number;
}

export interface InboundSms {
  providerMessageId: string;
  from: string;
  body: string;
  receivedAt: Date;
}

export type EvaluateWorkerAction =
  | { action: "TRY_NEXT_CANDIDATE" }
  | { action: "PROPOSE_FINAL_AGREEMENT" }
  | {
      action: "ASK_REQUESTER";
      reason: "PRICE_OUTSIDE_AUTO_APPROVAL" | "TIME_OUTSIDE_DEADLINE";
    }
  | { action: "TRY_RELAXATION_OR_NEXT_CANDIDATE" };

export type NextAction =
  | { type: "WAIT" }
  | { type: "CONTACT_MORE_CANDIDATES"; runId: string }
  | { type: "ASK_REQUESTER"; options: RelaxationOption[] }
  | { type: "REQUEST_FINAL_APPROVAL"; candidateId: string }
  | { type: "FINALIZE_AGREEMENT"; negotiationId: string }
  | { type: "NO_MATCH"; reason: string };

export type EligibilityReason =
  | "IS_REQUESTER"
  | "WORKER_DISABLED"
  | "UNAVAILABLE"
  | "CATEGORY_EXCLUDED"
  | "CATEGORY_NOT_OFFERED"
  | "MIN_PRICE_ABOVE_AUTHORIZED"
  | "ALREADY_CONTACTED_THIS_RUN"
  | "HAS_UNRESOLVED_TASK";

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
}

/**
 * Everything a personal agent is allowed to read about a student.
 * Embeddings stay on the user document; they are not part of this view.
 */
export interface PersonalAgentContext {
  userUuid: string;
  identity: {
    firstName: string;
    lastName: string;
    cmuEmail: string;
    phone: string;
  };
  preferenceText: string;
  worker: WorkerProfile;
  requester: RequesterProfile;
  availability: UserAvailability;
  stats: UserStats;
  capabilities: {
    canWork: boolean;
    canRequest: boolean;
    autoAcceptEnabled: boolean;
    autoRejectEnabled: boolean;
  };
}

export interface RankedCandidateView {
  candidate: TaskCandidate;
  worker: {
    uuid: string;
    firstName: string;
    lastName: string;
    categories: TaskCategory[];
    typicalLocations: string[];
    minPriceUsd?: number;
    preferredPriceUsd?: number;
    preferenceText: string;
  };
}
