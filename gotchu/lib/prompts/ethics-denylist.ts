/** @owner Daphne — fast deny-list prefilter before LLM / heuristics */
import type { EthicsCategory } from "@/lib/types/ethics";

export type DenylistRule = {
  category: EthicsCategory;
  pattern: RegExp;
};

export const DENYLIST: DenylistRule[] = [
  {
    category: "academic_integrity",
    pattern:
      /\b(write|do|complete|take|sit)\s+(my|your|the)\b[\s\S]{0,48}\b(essay|paper|lab|exam|quiz|homework|pset|problem\s*set)\b/i,
  },
  {
    category: "academic_integrity",
    pattern: /\b(exam|quiz|midterm|final|homework|problem\s*set|pset|lab\s*report)\b/i,
  },
  { category: "academic_integrity", pattern: /\b15-?213\b/i },
  {
    category: "controlled_substances",
    pattern: /\b(alcohol|beer|liquor|wine|weed|tobacco|vape|prescription)\b/i,
  },
  { category: "physical_safety", pattern: /\b(weapon|gun|knife|explosive)\b/i },
  {
    category: "credential_misuse",
    pattern:
      /\b(use[sd]?\s+my\s+(dining\s+)?id|impersonat|(?:my|their|someone.?s)\s+dining\s+id|fake\s+id)\b/i,
  },
  {
    category: "credential_misuse",
    pattern:
      /\b(package\s+pickup|pick(?:ing)?\s+up\s+(?:my\s+|a\s+|the\s+)?package|packages?\s+from\s+(?:the\s+)?(?:uc|mailroom)|pickup\s+authorization)\b/i,
  },
  { category: "illegal", pattern: /\b(steal|stolen|fraud|launder)\b/i },
];

/** Backward-compatible list if anything still iterates patterns only. */
export const DENYLIST_PATTERNS: RegExp[] = DENYLIST.map((r) => r.pattern);

export function matchDenylist(text: string): EthicsCategory[] {
  const blob = text.toLowerCase();
  const cats = new Set<EthicsCategory>();
  for (const { category, pattern } of DENYLIST) {
    if (pattern.test(blob)) cats.add(category);
  }
  return [...cats];
}
