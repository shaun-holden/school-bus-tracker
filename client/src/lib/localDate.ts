// The user's local calendar day as YYYY-MM-DD. Not toISOString(), which gives
// the UTC day: from about 7-8 pm in US zones that is already tomorrow.
// Pure and dependency-free so a Node unit test can import it.

export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The local day `days` calendar days after `from` (setDate, so DST-safe). */
export function localDateStringPlusDays(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return localDateString(d);
}
