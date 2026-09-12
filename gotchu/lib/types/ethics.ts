/** @owner Will */
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
