/** @owner Daphne — fast deny-list prefilter before LLM / heuristics */
import type { EthicsCategory } from "@/lib/types/ethics";

export type DenylistRule = {
  category: EthicsCategory;
  pattern: RegExp;
};

/** USD / cash-app methods. Anything else offered as pay is barter. */
const MONEY_METHOD =
  /\b(venmo|zelle|paypal|cash|usd|dollars?|money|bucks?|cents?|debit|credit|apple\s+pay|apple\s+cash|cards?)\b/i;

const QTY = String.raw`\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|some`;
const MONEY_OR_TIME = String.raw`dollars?|usd|bucks?|cents?|minutes?|hours?|mins?|hrs?|people|persons?|workers?`;

const SWAP_PHRASE =
  /\b(in\s+exchange(?:\s+for)?|barter|payment\s+in\s+kind|in\s+return\s+for|instead\s+of\s+(?:pay(?:ing|ment)?|cash|money|dollars?)|trade\s+(?:you|for)|for\s+free\s+if|compensat(?:e|ed|ion)\s+(?:in|with|is))\b/i;

const PAY_QTY_NOT_MONEY = new RegExp(
  String.raw`\b(?:paid?|pay(?:ing|s)?)\s+(?:(?:you|them|him|her)\s+)?(?:${QTY})\s+(?!${MONEY_OR_TIME}\b)`,
  "i",
);

const GIVE_QTY_NOT_MONEY = new RegExp(
  String.raw`\bgiv(?:e|ing|es)\b[\s\S]{0,48}\b(?:${QTY})\s+(?!${MONEY_OR_TIME}\b)`,
  "i",
);

const PLUS_QTY_NOT_MONEY = new RegExp(
  String.raw`\b(along with|together with|throw in|plus)\b[\s\S]{0,32}\b(?:${QTY})\s+(?!${MONEY_OR_TIME}\b)`,
  "i",
);

const PAY_WITH = /\b(?:paid?|pay(?:ing|ment|s)?)\s+(?:(?:you|them|him|her|the\s+(?:person|worker|runner))\s+)?(?:in|with|using)\s+([a-z][a-z\s]{0,24})/gi;

/**
 * True when the worker is being compensated in something other than USD.
 * Food *runs* that buy items with Venmo/cash still return false.
 */
export function looksLikeBarterPay(text: string): boolean {
  if (SWAP_PHRASE.test(text)) return true;
  if (PAY_QTY_NOT_MONEY.test(text)) return true;
  if (GIVE_QTY_NOT_MONEY.test(text)) return true;
  if (PLUS_QTY_NOT_MONEY.test(text)) return true;

  PAY_WITH.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAY_WITH.exec(text))) {
    const offered = m[1]?.trim() ?? "";
    if (offered && !MONEY_METHOD.test(offered)) return true;
  }
  return false;
}

export const DENYLIST: DenylistRule[] = [
  {
    category: "academic_integrity",
    pattern:
      /\b(write|do|complete|take|sit)\s+(my|your|the)\b[\s\S]{0,48}\b(essay|paper|lab|exam|quiz|homework|pset|problem\s*set)\b/i,
  },
  {
    category: "academic_integrity",
    pattern: /\b(exam|quiz|midterm|final|homework|problem\s*set|pset|lab\s+report)\b/i,
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
  { category: "financial_risk", pattern: SWAP_PHRASE },
];

/** Backward-compatible list if anything still iterates patterns only. */
export const DENYLIST_PATTERNS: RegExp[] = DENYLIST.map((r) => r.pattern);

/**
 * Extra non-money compensation is always banned, even if a dollar price is
 * also set. A food *run* that buys coffee with USD is ok.
 */
export function looksLikeOpenPriceBarter(
  text: string,
  _maxPriceUsd: number | undefined | null,
  category?: string,
): boolean {
  void _maxPriceUsd;
  if (looksLikeBarterPay(text)) return true;

  const campusInKind = /\b(coffees?|pizzas?|swipes|favou?rs)\b/i.test(text);
  if (!campusInKind) return false;

  // Fetching a coffee is the most ordinary task on this marketplace, and the
  // only thing separating it from offering coffee AS payment is the verb. The
  // list has to cover how people actually write it - "drop it at Gates",
  // "take it to Wean", "run to La Prima" - or a plain USD-priced delivery gets
  // refused as barter.
  const foodFetch =
    (category === "food" || category === "pickup" || category === "errand") &&
    /\b(pick\s*up|pickup|drop\s*off|dropoff|drop|get|grab|bring|deliver|delivery|order|buy|fetch|take|carry|collect|run)\b/i.test(
      text,
    );
  if (foodFetch) return false;
  return true;
}

export function matchDenylist(text: string): EthicsCategory[] {
  const blob = text.toLowerCase();
  const cats = new Set<EthicsCategory>();
  for (const { category, pattern } of DENYLIST) {
    pattern.lastIndex = 0;
    if (pattern.test(blob)) cats.add(category);
  }
  if (looksLikeBarterPay(blob)) cats.add("financial_risk");
  return [...cats];
}
