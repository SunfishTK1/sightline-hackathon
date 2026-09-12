/** Worker is asking for more clock, not a different job. */
export function looksLikeTimeAsk(note?: string | null): boolean {
  if (!note) return false;
  return /\b(more time|need time|need until|need till|can'?t make|cannot make|won'?t make|too tight|running late|later deadline|push (the )?deadline|until \d|by \d{1,2}\s*(am|pm)|extra \d+\s*min|another \d+\s*min|\d+\s*more min|need (an? )?(hour|hourish|\d+\s*min))/i.test(
    note,
  );
}

export function minutesFromTimeNote(note?: string | null): number | undefined {
  if (!note) return undefined;
  const extra = note.match(/\b(\d{1,3})\s*(more\s+)?min/i);
  if (extra) return Number(extra[1]);
  const hours = note.match(/\b(\d{1,2})\s*hours?\b/i);
  if (hours) return Number(hours[1]) * 60;
  return undefined;
}
