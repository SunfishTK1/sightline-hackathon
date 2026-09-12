/** @owner Daphne — ethics gate + arbitration verdicts */
import { z } from "zod";
import type { StructuredTask } from "./task";
import type { NegotiationMessage, NegotiationRole } from "./offer";

export type EthicsVerdictLabel = "ALLOW" | "ALLOW_WITH_CONDITIONS" | "BLOCK";

export type EthicsCategory =
  | "academic_integrity"
  | "controlled_substances"
  | "physical_safety"
  | "credential_misuse"
  | "harassment"
  | "illegal"
  | "financial_risk"
  | "none";

export interface EthicsVerdict {
  verdict: EthicsVerdictLabel;
  categories: EthicsCategory[];
  conditions: string[];
  reason: string;
  confidence?: number;
  reviewedAt?: string;
}

export type AmendmentVerdictLabel = "ALLOW" | "REJECT";

export interface FieldChange {
  path: string;
  from: unknown;
  to: unknown;
  why?: string;
}

export interface AmendmentVerdict {
  verdict: AmendmentVerdictLabel;
  sameTask: boolean;
  allowedChanges: { path: string; from: unknown; to: unknown }[];
  rejectedChanges: { path: string; from: unknown; to: unknown; why: string }[];
  reason: string;
}

export type ArbitrationVerdictLabel =
  | "ALLOW"
  | "STRIP_AMENDMENTS"
  | "REJECT_MOVE"
  | "BLOCK_TASK";

export interface ProposedMove {
  priceUsd: number;
  etaMinutes: number;
  rationale: string;
  accept: boolean;
  amendments?: { path: string; to: unknown }[];
}

export interface ArbitrateInput {
  originalStructured: StructuredTask;
  currentStructured: StructuredTask;
  role: NegotiationRole;
  proposed: ProposedMove;
  transcript: NegotiationMessage[];
}

export interface ArbitrationVerdict {
  verdict: ArbitrationVerdictLabel;
  priceUsd: number;
  structured: StructuredTask;
  stripped: { path: string; why: string }[];
  reason: string;
}

export const ethicsCategorySchema = z.enum([
  "academic_integrity",
  "controlled_substances",
  "physical_safety",
  "credential_misuse",
  "harassment",
  "illegal",
  "financial_risk",
  "none",
]);

export const ethicsVerdictSchema = z.object({
  verdict: z.enum(["ALLOW", "ALLOW_WITH_CONDITIONS", "BLOCK"]),
  categories: z.array(ethicsCategorySchema),
  conditions: z.array(z.string()),
  reason: z.string(),
  confidence: z.number().optional(),
  reviewedAt: z.string().optional(),
});

export const amendmentVerdictSchema = z.object({
  verdict: z.enum(["ALLOW", "REJECT"]),
  sameTask: z.boolean(),
  allowedChanges: z.array(
    z.object({
      path: z.string(),
      from: z.unknown(),
      to: z.unknown(),
    }),
  ),
  rejectedChanges: z.array(
    z.object({
      path: z.string(),
      from: z.unknown(),
      to: z.unknown(),
      why: z.string(),
    }),
  ),
  reason: z.string(),
});

export const arbitrationVerdictSchema = z.object({
  verdict: z.enum(["ALLOW", "STRIP_AMENDMENTS", "REJECT_MOVE", "BLOCK_TASK"]),
  priceUsd: z.number(),
  structured: z.unknown(),
  stripped: z.array(z.object({ path: z.string(), why: z.string() })),
  reason: z.string(),
});
