/**
 * @owner Will
 * Ethics agent — reviewTask + reviewComment
 */
import type { StructuredTask } from "@/lib/types/task";
import type { EthicsVerdict } from "@/lib/types/ethics";
import { DENYLIST_PATTERNS } from "@/lib/prompts/ethics-denylist";

export async function reviewTask(
  structured: StructuredTask,
): Promise<EthicsVerdict> {
  const blob = JSON.stringify(structured).toLowerCase();
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(blob)) {
      return {
        verdict: "BLOCK",
        categories: ["academic_integrity"],
        conditions: [],
        reason: "This request looks like it may violate campus integrity or safety rules.",
        confidence: 1,
        reviewedAt: new Date().toISOString(),
      };
    }
  }

  // TODO(Will): LLM rubric (§6c); safe default ALLOW for demos
  return {
    verdict: "ALLOW",
    categories: ["none"],
    conditions: [],
    reason: "Routine campus errand, no integrity or safety concerns.",
    confidence: 0.5,
    reviewedAt: new Date().toISOString(),
  };
}

export async function reviewComment(
  comment: string,
): Promise<string | null> {
  // TODO(Will): run comment through ethics; return flag or null
  void comment;
  return null;
}
