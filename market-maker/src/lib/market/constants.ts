import type { TaskCategory } from "./types";

export const OUTREACH_BATCH_SIZE = 3;
export const DEMO_EXPIRATION_SECONDS = 45;
export const PROD_EXPIRATION_SECONDS = 5 * 60;
export const MAX_MARKET_ATTEMPTS = 3;
export const MAX_NEGOTIATION_ROUNDS = 3;
export const SMS_PARSE_MIN_CONFIDENCE = 0.7;
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export const RANKING_WEIGHTS = {
  semanticFit: 0.4,
  availabilityFit: 0.2,
  priceFit: 0.15,
  reliability: 0.1,
  categoryExperience: 0.1,
  locationFit: 0.05,
} as const;

/** Neutral prior so new students can still compete. */
export const NEW_USER_RELIABILITY = 0.7;
export const RELIABILITY_MIN_RATINGS = 3;

export const DEMO_TASK_ID = "task-demo-package";
export const DEMO_REQUESTER_UUID = "user-divya";

export const VECTOR_SEARCH_INDEX = "user_preference_embedding_index";
export const VECTOR_CANDIDATE_LIMIT = 25;

export const COLLECTION_NAMES = {
  users: "users",
  tasks: "tasks",
  taskCandidates: "task_candidates",
  negotiations: "negotiations",
  messages: "messages",
  taskEvents: "task_events",
  reviews: "reviews",
  matchingRuns: "matching_runs",
  agreements: "agreements",
} as const;

export const DEFAULT_WORKER_CATEGORIES: TaskCategory[] = [
  "FOOD_RUN",
  "PACKAGE_PICKUP",
  "CAMPUS_ERRAND",
];
