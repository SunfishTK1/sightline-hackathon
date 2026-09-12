/**
 * @owner Daphne
 * Ethics + arbitration — reviewTask, reviewAmendment, arbitrateMove, reviewComment
 */
import type { StructuredTask, TaskCategory } from "@/lib/types/task";
import type {
  AmendmentVerdict,
  ArbitrateInput,
  ArbitrationVerdict,
  EthicsCategory,
  EthicsVerdict,
} from "@/lib/types/ethics";
import {
  matchDenylist,
  looksLikeOpenPriceBarter,
  looksLikeBarterPay,
} from "@/lib/prompts/ethics-denylist";
import { HANDBOOK_REASONS } from "@/lib/prompts/ethics-handbook";

const TASK_CATEGORIES: TaskCategory[] = [
  "pickup",
  "food",
  "moving",
  "errand",
  "tutoring_allowed",
  "other",
];

/**
 * HTTP payloads from voice-mcp use `description` (the order details) and
 * sometimes snake_case / missing price. Fold those onto StructuredTask so the
 * same-job check actually sees what the person said.
 */
export function parseEthicsStructured(raw: unknown): StructuredTask | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) return null;

  let category: string =
    typeof o.category === "string" && o.category.trim() ? o.category.trim() : "other";
  if (category === "tutoring") category = "tutoring_allowed";
  if (!(TASK_CATEGORIES as string[]).includes(category)) category = "other";

  const extras = [o.description, o.details]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  const fromArray = Array.isArray(o.requirements)
    ? o.requirements.filter((v): v is string => typeof v === "string")
    : [];
  const requirements = [...fromArray, ...extras];

  const pickup = o.pickupLocation ?? o.pickup_location;
  const dropoff = o.dropoffLocation ?? o.dropoff_location;
  const priceRaw = o.maxPriceUsd;
  const maxPriceUsd =
    typeof priceRaw === "number" && Number.isFinite(priceRaw)
      ? priceRaw
      : typeof priceRaw === "string" && Number.isFinite(Number(priceRaw))
        ? Number(priceRaw)
        : 0;

  return {
    title,
    category: category as TaskCategory,
    pickupLocation:
      typeof pickup === "string" && pickup.trim() ? pickup.trim() : undefined,
    dropoffLocation:
      typeof dropoff === "string" && dropoff.trim() ? dropoff.trim() : undefined,
    deadline: typeof o.deadline === "string" ? o.deadline : undefined,
    maxPriceUsd,
    estimatedMinutes:
      typeof o.estimatedMinutes === "number" && Number.isFinite(o.estimatedMinutes)
        ? o.estimatedMinutes
        : undefined,
    requirements: requirements.length ? requirements : undefined,
  };
}

const PRICE_FIELDS = new Set(["maxPriceUsd", "estimatedMinutes"]);

const EXTRA_CHORE =
  /\b(walk(?:ing)?\s+(?:the\s+)?(?:my\s+)?dog|airport|also\s+(?:write|walk|take|do|drive|paint)|and\s+write\s+my)\b/i;

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
  if (categories.includes("financial_risk")) {
    return HANDBOOK_REASONS.financial_risk;
  }
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
  const text = blob(structured);
  const hits = matchDenylist(text);
  if (hits.length) {
    return blockVerdict(hits, handbookBlockReason(hits, text));
  }
  if (looksLikeOpenPriceBarter(text, structured.maxPriceUsd, structured.category)) {
    return blockVerdict(
      ["financial_risk"],
      HANDBOOK_REASONS.financial_risk,
    );
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

  const proposedHits = matchDenylist(proposedText);
  const barter =
    proposedHits.includes("financial_risk") ||
    looksLikeOpenPriceBarter(
      proposedText,
      proposedStructured.maxPriceUsd,
      proposedStructured.category,
    );

  if (barter || proposedHits.includes("controlled_substances") || proposedHits.includes("credential_misuse") || proposedHits.includes("academic_integrity") || proposedHits.includes("illegal") || proposedHits.includes("physical_safety") || proposedHits.includes("harassment")) {
    return {
      verdict: "REJECT",
      sameTask: false,
      allowedChanges: [],
      rejectedChanges: changes.map((c) => ({
        ...c,
        why: barter
          ? "Payment must be money (USD), not coffee or other barter."
          : "Change introduces a blocked ethics issue.",
      })),
      reason: barter
        ? HANDBOOK_REASONS.financial_risk
        : "Keep the original job. This edit is not allowed.",
    };
  }

  const newHits = proposedHits.filter(
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
    looksLikeBarterPay(proposed.rationale) ||
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
