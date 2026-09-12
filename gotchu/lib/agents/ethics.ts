/**
 * @owner Daphne
 * Ethics + arbitration — reviewTask, reviewAmendment, arbitrateMove, reviewComment
 */
import type { StructuredTask } from "@/lib/types/task";
import type {
  AmendmentVerdict,
  ArbitrateInput,
  ArbitrationVerdict,
  EthicsCategory,
  EthicsVerdict,
} from "@/lib/types/ethics";
import { matchDenylist } from "@/lib/prompts/ethics-denylist";
import { HANDBOOK_REASONS } from "@/lib/prompts/ethics-handbook";

const PRICE_FIELDS = new Set(["maxPriceUsd", "estimatedMinutes"]);

const EXTRA_CHORE =
  /\b(walk(?:ing)?\s+(?:the\s+)?(?:my\s+)?dog|airport|also\s+(?:write|walk|take|do|drive|paint)|and\s+write\s+my)\b/i;

const BARTER =
  /\b(for\s+free\s+if|in\s+exchange\s+for|instead\s+of\s+(?:pay|cash|money)|barter|trade\s+you)\b/i;

function blob(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function cloneStructured(task: StructuredTask): StructuredTask {
  return {
    ...task,
    requirements: task.requirements ? [...task.requirements] : undefined,
  };
}

function applyAmendments(
  current: StructuredTask,
  amendments: { path: string; to: unknown }[],
): StructuredTask {
  const next = cloneStructured(current) as StructuredTask & Record<string, unknown>;
  for (const { path, to } of amendments) {
    next[path] = to;
  }
  return next;
}

function nonPriceDiffs(original: StructuredTask, proposed: StructuredTask) {
  const a = original as unknown as Record<string, unknown>;
  const b = proposed as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: { path: string; from: unknown; to: unknown }[] = [];
  for (const path of keys) {
    if (PRICE_FIELDS.has(path)) continue;
    const from = a[path];
    const to = b[path];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ path, from, to });
    }
  }
  return changes;
}

function handbookBlockReason(
  categories: EthicsCategory[],
  structuredBlob: string,
): string {
  if (categories.includes("controlled_substances")) {
    return HANDBOOK_REASONS.controlled_substances;
  }
  if (/\bpackage\b/i.test(structuredBlob)) {
    return HANDBOOK_REASONS.credential_misuse;
  }
  for (const cat of categories) {
    const line = HANDBOOK_REASONS[cat];
    if (line) return line;
  }
  return "This request looks like it may violate Carnegie Mellon's Student Handbook (The Word).";
}

function extraChoreAdded(originalText: string, proposedText: string): boolean {
  return EXTRA_CHORE.test(proposedText) && !EXTRA_CHORE.test(originalText);
}

function blockVerdict(
  categories: EthicsCategory[],
  reason: string,
): EthicsVerdict {
  return {
    verdict: "BLOCK",
    categories,
    conditions: [],
    reason,
    confidence: 1,
    reviewedAt: new Date().toISOString(),
  };
}

function heuristicReview(structured: StructuredTask): EthicsVerdict {
  const conditions: string[] = [];
  const text = blob(structured);

  if (structured.category === "tutoring_allowed" || /\btutor/i.test(text)) {
    conditions.push("Tutoring may explain concepts only — do not complete graded work.");
  }
  if (/\b(apartment|residence|house|dorm\s+room)\b/i.test(text)) {
    conditions.push("Private residence — both parties should confirm they are comfortable.");
  }

  if (conditions.length) {
    return {
      verdict: "ALLOW_WITH_CONDITIONS",
      categories: ["none"],
      conditions,
      reason: "Allowed with conditions so the job stays a normal campus errand.",
      confidence: 0.7,
      reviewedAt: new Date().toISOString(),
    };
  }

  return {
    verdict: "ALLOW",
    categories: ["none"],
    conditions: [],
    reason: "Routine campus task, no integrity or safety concerns.",
    confidence: 0.7,
    reviewedAt: new Date().toISOString(),
  };
}

export async function reviewTask(
  structured: StructuredTask,
): Promise<EthicsVerdict> {
  const hits = matchDenylist(blob(structured));
  if (hits.length) {
    const text = blob(structured);
    return blockVerdict(hits, handbookBlockReason(hits, text));
  }
  return heuristicReview(structured);
}

export async function reviewAmendment(
  originalStructured: StructuredTask,
  proposedStructured: StructuredTask,
): Promise<AmendmentVerdict> {
  const originalText = blob(originalStructured);
  const proposedText = blob(proposedStructured);
  const changes = nonPriceDiffs(originalStructured, proposedStructured);

  const newHits = matchDenylist(proposedText).filter(
    (c) => !matchDenylist(originalText).includes(c),
  );
  const identityBreak =
    originalStructured.category !== proposedStructured.category ||
    extraChoreAdded(originalText, proposedText) ||
    newHits.length > 0;

  if (!changes.length) {
    return {
      verdict: "ALLOW",
      sameTask: true,
      allowedChanges: [],
      rejectedChanges: [],
      reason: "Only price or ETA changed — that is not a job amendment.",
    };
  }

  if (identityBreak) {
    return {
      verdict: "REJECT",
      sameTask: false,
      allowedChanges: [],
      rejectedChanges: changes.map((c) => ({
        ...c,
        why: newHits.length
          ? "Change introduces a blocked ethics issue."
          : "This would turn the request into a different job.",
      })),
      reason: "Keep the original job. Details may flex; the task itself may not.",
    };
  }

  return {
    verdict: "ALLOW",
    sameTask: true,
    allowedChanges: changes,
    rejectedChanges: [],
    reason: "Same job with a cosmetic or parametric tweak.",
  };
}

export async function arbitrateMove(
  input: ArbitrateInput,
): Promise<ArbitrationVerdict> {
  const { originalStructured, currentStructured, proposed } = input;
  const amendments = proposed.amendments ?? [];
  const scanText = blob([proposed.rationale, amendments, proposed]);

  const hits = matchDenylist(scanText);
  if (hits.length) {
    return {
      verdict: "BLOCK_TASK",
      priceUsd: proposed.priceUsd,
      structured: cloneStructured(currentStructured),
      stripped: amendments.map((a) => ({
        path: a.path,
        why: "Ethics violation in this turn.",
      })),
      reason: "This turn violates CMU's Student Handbook (The Word). Stop the deal.",
    };
  }

  const patched = applyAmendments(currentStructured, amendments);
  const amendment = await reviewAmendment(originalStructured, patched);
  const barterOrChore =
    BARTER.test(proposed.rationale) ||
    extraChoreAdded(blob(originalStructured), proposed.rationale);

  if (!amendment.sameTask || amendment.verdict === "REJECT" || barterOrChore) {
    return {
      verdict: "STRIP_AMENDMENTS",
      priceUsd: proposed.priceUsd,
      structured: cloneStructured(currentStructured),
      stripped: amendments.map((a) => ({
        path: a.path,
        why: "Price may move; the job identity may not.",
      })),
      reason: "Keep the original job. Agents may only trade on price.",
    };
  }

  return {
    verdict: "ALLOW",
    priceUsd: proposed.priceUsd,
    structured: patched,
    stripped: [],
    reason: "Price offer is on the same job.",
  };
}

export async function reviewComment(
  comment: string,
): Promise<string | null> {
  const hits = matchDenylist(comment);
  return hits[0] ?? null;
}
