/** @owner Will — fast deny-list prefilter before LLM */
export const DENYLIST_PATTERNS: RegExp[] = [
  /\b(exam|quiz|midterm|final)\b/i,
  /\b(homework|problem\s*set|pset|lab\s*report)\b/i,
  /\b(write\s+(my|your|the)\s+(essay|paper|lab))\b/i,
  /\b(alcohol|beer|liquor|weed|prescription)\b/i,
  /\b(weapon|gun|knife)\b/i,
  /\b(use\s+my\s+id|impersonat)/i,
];
