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
    pattern:
      /\b(alcohol|alcoholic|beer|beers|liquor|wine|wines|booze|vodka|gin|whiskey|whisky|tequila|rum|champagne|cocktail|cocktails|keg|ipa|hard\s+seltzer|seltzer)\b/i,
  },
  {
    category: "controlled_substances",
    pattern:
      /\b(liquor\s+store|wine\s+(?:shop|store)|beer\s+run|keg\s+stand|byob)\b/i,
  },
  { category: "controlled_substances", pattern: /\b(weed|tobacco|vape|prescription)\b/i },
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
  {
    category: "financial_risk",
    pattern:
      /\b(in\s+exchange\s+for|barter|payment\s+in\s+kind|instead\s+of\s+(?:pay(?:ing|ment)?|cash|money|dollars?))\b/i,
  },
  {
    category: "financial_risk",
    pattern:
      /\b(paid?|pay(?:ment)?)\s+(?:in|with)\s+(?:coffee|coffees|pizza|pizzas|food|favou?rs?|meals?|swipes?|dining)\b/i,
  },
  {
    category: "financial_risk",
    pattern:
      /\bfor\s+\d+\s+(?:coffees?|pizzas?|swipes?|meals?|favou?rs?)\b/i,
  },
  {
    category: "financial_risk",
    pattern:
      /\b(give|giving|gives)\b[\s\S]{0,48}\b(\d+\s+)?(coffees?|pizzas?|swipes?|meals?)\b/i,
  },
  {
    category: "financial_risk",
    pattern:
      /\b(along with|together with|throw in|plus)\b[\s\S]{0,24}\b(\d+\s+)?(coffees?|pizzas?|swipes?)\b/i,
  },
];

/** Backward-compatible list if anything still iterates patterns only. */
export const DENYLIST_PATTERNS: RegExp[] = DENYLIST.map((r) => r.pattern);

/**
 * Extra non-money compensation (coffees, pizza, swipes) is always banned,
 * even if a dollar price is also set. A food *run* that buys coffee with USD is ok.
 */
export function looksLikeOpenPriceBarter(
  text: string,
  _maxPriceUsd: number | undefined | null,
  category?: string,
): boolean {
  void _maxPriceUsd;
  const inKind =
    /\b\d+\s+coffees?\b/i.test(text) ||
    /\b(coffees|pizzas|swipes|favou?rs)\b/i.test(text);
  if (!inKind) return false;
  const extraPay =
    /\b(in\s+exchange|barter|throw in|along with|together with|give|giving|paid? in|pay(?:ment)? with|plus)\b/i.test(
      text,
    );
  const foodFetch =
    category === "food" &&
    /\b(pick\s*up|pickup|get|grab|deliver|order)\b/i.test(text);
  if (foodFetch && !extraPay) return false;
  return true;
}

export function matchDenylist(text: string): EthicsCategory[] {
  const blob = text.toLowerCase();
  const cats = new Set<EthicsCategory>();
  for (const { category, pattern } of DENYLIST) {
    if (pattern.test(blob)) cats.add(category);
  }
  return [...cats];
}
