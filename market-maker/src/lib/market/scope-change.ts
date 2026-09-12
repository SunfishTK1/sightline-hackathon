/** Extra unpaid labor, hostage terms, or a different job stuffed into a counter. */
const SCOPE_CHANGE =
  /\b(also|plus)\b.*\b(need|require|bring|want)\b|\bor i (will |'ll )?cancel\b|\bunless you\b|\bfive coffees\b|\bextra (unpaid )?work\b|\bdo this or\b/i;

export function looksLikeScopeChange(note?: string | null): boolean {
  if (!note?.trim()) return false;
  return SCOPE_CHANGE.test(note);
}
