/**
 * @owner Will
 * E.164 normalize + US-friendly display mask.
 */

const E164 = /^\+[1-9]\d{7,14}$/;

export function isE164(value: string): boolean {
  return E164.test(value);
}

/** Digits only, preserving a leading + if present in the raw string. */
export function digitsOf(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Turn typed input into E.164.
 * 10-digit US numbers become +1XXXXXXXXXX.
 * Already-international numbers (11–15 digits, or starting with +) stay as +digits.
 */
export function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = digitsOf(trimmed);
  if (!digits) return null;

  if (trimmed.startsWith("+")) {
    const candidate = `+${digits}`;
    return isE164(candidate) ? candidate : null;
  }

  if (digits.length === 10) {
    const candidate = `+1${digits}`;
    return isE164(candidate) ? candidate : null;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    const candidate = `+${digits}`;
    return isE164(candidate) ? candidate : null;
  }

  const candidate = `+${digits}`;
  return isE164(candidate) ? candidate : null;
}

/** Display mask: +1 (412) 555-0123 for US, otherwise +XXXXXXXX. */
export function formatPhoneMask(raw: string): string {
  const trimmed = raw.trim();
  const digits = digitsOf(trimmed);
  if (!digits) return trimmed.startsWith("+") ? "+" : "";

  const e164ish = trimmed.startsWith("+")
    ? `+${digits}`
    : digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith("1")
        ? `+${digits}`
        : `+${digits}`;

  if (e164ish.startsWith("+1") && e164ish.length <= 12) {
    const rest = e164ish.slice(2);
    const a = rest.slice(0, 3);
    const b = rest.slice(3, 6);
    const c = rest.slice(6, 10);
    if (!a) return "+1";
    if (!b) return `+1 (${a}`;
    if (!c) return `+1 (${a}) ${b}`;
    return `+1 (${a}) ${b}-${c}`;
  }

  return e164ish;
}
