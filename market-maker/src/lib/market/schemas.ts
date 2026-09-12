import { z } from "zod";
import {
  MESSAGE_PURPOSES,
  NEGOTIATION_EVENT_TYPES,
  TASK_CATEGORIES,
  TASK_STATUSES,
  WORKER_DECISIONS,
} from "./types";

export const taskCategorySchema = z.enum(TASK_CATEGORIES);
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const workerDecisionSchema = z.enum(WORKER_DECISIONS);

export const foodRunDetailsSchema = z.object({
  kind: z.literal("FOOD_RUN"),
  vendor: z.string().min(1),
  pickupLocation: z.string().min(1),
  dropoffLocation: z.string().min(1),
  orderSummary: z.string().optional(),
  dietaryNotes: z.string().optional(),
  needsPaymentOnPickup: z.boolean(),
});

export const packagePickupDetailsSchema = z.object({
  kind: z.literal("PACKAGE_PICKUP"),
  pickupLocation: z.string().min(1),
  dropoffLocation: z.string().min(1),
  carrier: z.string().optional(),
  trackingHint: z.string().optional(),
  requiresAuthorization: z.boolean(),
  packageSize: z.enum(["SMALL", "MEDIUM", "LARGE"]).optional(),
});

export const campusErrandDetailsSchema = z.object({
  kind: z.literal("CAMPUS_ERRAND"),
  stops: z.array(z.string().min(1)).min(1),
  errandSummary: z.string().min(1),
});

export const movingDetailsSchema = z.object({
  kind: z.literal("MOVING"),
  pickupLocation: z.string().min(1),
  dropoffLocation: z.string().min(1),
  itemDescription: z.string().min(1),
  approximateWeightLbs: z.number().positive().optional(),
  stairsOrElevator: z.enum(["STAIRS", "ELEVATOR", "UNKNOWN"]).optional(),
  helpersNeeded: z.number().int().positive(),
});

export const tutoringDetailsSchema = z.object({
  kind: z.literal("TUTORING"),
  courseCode: z.string().optional(),
  subject: z.string().min(1),
  meetingLocation: z.string().min(1),
  sessionMinutes: z.number().int().positive(),
});

export const otherTaskDetailsSchema = z.object({
  kind: z.literal("OTHER"),
  summary: z.string().min(1),
  location: z.string().optional(),
});

export const categoryDetailsSchema = z.discriminatedUnion("kind", [
  foodRunDetailsSchema,
  packagePickupDetailsSchema,
  campusErrandDetailsSchema,
  movingDetailsSchema,
  tutoringDetailsSchema,
  otherTaskDetailsSchema,
]);

/** LLM / personal-agent output: free-text task post → structured constraints. */
export const parsedTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: taskCategorySchema,
  pickupLocation: z.string().optional(),
  dropoffLocation: z.string().optional(),
  meetingLocation: z.string().optional(),
  earliestStartAt: z.coerce.date().optional(),
  deadline: z.coerce.date(),
  estimatedMinutes: z.number().int().positive(),
  requirements: z.array(z.string()),
  categoryDetails: categoryDetailsSchema.optional(),
  initialOfferUsd: z.number().positive(),
  maximumUsd: z.number().positive(),
  confidence: z.number().min(0).max(1),
});

export const autoAcceptRulesSchema = z.object({
  minPriceUsd: z.number().nonnegative(),
  maxEstimatedMinutes: z.number().int().positive(),
  categories: z.array(taskCategorySchema),
});

export const workerProfileSchema = z.object({
  enabled: z.boolean(),
  categories: z.array(taskCategorySchema),
  excludedCategories: z.array(taskCategorySchema),
  typicalLocations: z.array(z.string()),
  availabilityText: z.string().nullish(),
  minPriceUsd: z.number().nonnegative().nullish(),
  preferredPriceUsd: z.number().nonnegative().nullish(),
  maxTravelMinutes: z.number().int().positive().nullish(),
  allowAgentAutoReject: z.boolean(),
  allowAgentAutoAccept: z.boolean(),
  autoAcceptRules: autoAcceptRulesSchema.nullish(),
});

export const requesterProfileSchema = z.object({
  defaultMaxPriceUsd: z.number().positive().nullish(),
  allowAutomaticCounters: z.boolean(),
  maxAutomaticPriceIncreaseUsd: z.number().nonnegative().nullish(),
  maxAutomaticDeadlineExtensionMinutes: z.number().int().nonnegative().nullish(),
});

export const userStatsSchema = z.object({
  tasksRequested: z.number().int().nonnegative(),
  tasksCompletedAsWorker: z.number().int().nonnegative(),
  requesterAvgRating: z.number().min(0).max(5).nullable(),
  workerAvgRating: z.number().min(0).max(5).nullable(),
  ratingCount: z.number().int().nonnegative(),
  acceptanceRate: z.number().min(0).max(1).nullable(),
  completionRate: z.number().min(0).max(1).nullable(),
});

export const userAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
  until: z.coerce.date().nullish(),
});

/** What a personal agent may retrieve and act on. */
export const personalAgentContextSchema = z.object({
  userUuid: z.string().min(1),
  identity: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    cmuEmail: z.string().email(),
    phone: z.string().min(8),
  }),
  preferenceText: z.string(),
  worker: workerProfileSchema,
  requester: requesterProfileSchema,
  availability: userAvailabilitySchema,
  stats: userStatsSchema,
  capabilities: z.object({
    canWork: z.boolean(),
    canRequest: z.boolean(),
    autoAcceptEnabled: z.boolean(),
    autoRejectEnabled: z.boolean(),
  }),
});

/** Personal agent output: messy SMS → structured worker reply. */
export const parsedWorkerSmsSchema = z.object({
  decision: workerDecisionSchema,
  priceUsd: z.number().positive().optional(),
  availableAt: z.coerce.date().optional(),
  estimatedCompletionAt: z.coerce.date().optional(),
  rawText: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

/** Personal agent output: requester numbered-choice SMS. */
export const parsedRequesterChoiceSchema = z.object({
  choice: z.enum(["1", "2", "NO", "APPROVE", "REJECT"]),
  confidence: z.number().min(0).max(1),
});

/** Ethics agent output. */
export const ethicsVerdictSchema = z.object({
  allowed: z.boolean(),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  reasons: z.array(z.string()),
});

/** LLM output: why this worker was ranked. */
export const candidateExplanationSchema = z.object({
  reasons: z.array(z.string()).min(1),
});

/** LLM output: suggested price/time ladder. Code still owns bounds. */
export const relaxationSuggestionSchema = z.object({
  options: z
    .array(
      z.object({
        step: z.number().int().positive(),
        label: z.string(),
        deadline: z.coerce.date(),
        proposedPriceUsd: z.number().positive(),
        requiresRequesterApproval: z.boolean(),
      }),
    )
    .min(1)
    .max(3),
});

export const startMatchBodySchema = z.object({
  demoMode: z.boolean().optional(),
});

export const outreachBodySchema = z.object({
  candidateIds: z.array(z.string()).min(1).optional(),
});

export const approveNegotiationBodySchema = z.object({
  actor: z.enum(["REQUESTER", "WORKER"]),
  approved: z.boolean(),
});

export const relaxTaskBodySchema = z.object({
  step: z.number().int().positive(),
  approved: z.boolean(),
});

export const inboundTwilioSchema = z.object({
  MessageSid: z.string(),
  From: z.string(),
  Body: z.string(),
});

export const twilioStatusSchema = z.object({
  MessageSid: z.string(),
  MessageStatus: z.string(),
});

export const negotiationEventTypeSchema = z.enum(NEGOTIATION_EVENT_TYPES);
export const messagePurposeSchema = z.enum(MESSAGE_PURPOSES);

const moneyLike = z.union([z.string(), z.number()]).nullable().optional();

export const brokerOrderSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  details: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  pickup_location: z.string().nullable().optional(),
  dropoff_location: z.string().nullable().optional(),
  deadline_at: z.string().nullable().optional(),
  budget_usd: moneyLike,
  urgency: z.string().nullable().optional(),
  requester_phone: z.string().nullable().optional(),
  maximum_usd: moneyLike,
  comps: z.array(z.number()).optional(),
});

export const brokerCandidateSchema = z.object({
  phone: z.string().min(1),
  blurb: z.string().nullable().optional(),
  categories: z.array(z.string()).optional(),
  min_price_usd: moneyLike,
  preferred_price_usd: moneyLike,
  stats: z
    .object({
      ratingCount: z.number().optional(),
      workerAvgRating: z.number().nullable().optional(),
      tasksCompletedAsWorker: z.number().optional(),
      completionRate: z.number().nullable().optional(),
    })
    .optional(),
});

export const brokerQuoteRequestSchema = z.object({
  order: brokerOrderSchema,
  candidates: z.array(brokerCandidateSchema),
});

export const brokerEvaluateRequestSchema = z.object({
  order: brokerOrderSchema,
  current_offer_usd: z.union([z.string(), z.number()]),
  decision: z.enum([
    "ACCEPT",
    "DECLINE",
    "COUNTER",
    "REQUESTER_YES",
    "REQUESTER_NO",
    "AUTO_WORKER",
    "AUTO_REQUESTER",
    "TIMEOUT",
    "NEED_TIME",
  ]),
  price_usd: moneyLike,
  worker_min_usd: moneyLike,
  note: z.string().nullable().optional(),
  round: z.number().int().nonnegative().optional(),
  estimated_minutes: z.number().int().positive().optional(),
});

export type ParsedTaskInput = z.infer<typeof parsedTaskSchema>;
export type ParsedWorkerSms = z.infer<typeof parsedWorkerSmsSchema>;
export type ParsedRequesterChoice = z.infer<typeof parsedRequesterChoiceSchema>;
export type BrokerOrderInput = z.infer<typeof brokerOrderSchema>;
export type BrokerCandidateInput = z.infer<typeof brokerCandidateSchema>;
export type BrokerQuoteRequest = z.infer<typeof brokerQuoteRequestSchema>;
export type BrokerEvaluateRequest = z.infer<typeof brokerEvaluateRequestSchema>;
