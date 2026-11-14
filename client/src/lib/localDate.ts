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

/**
 * Shows a stored date-only value as the day that was stored.
 * For date-only values the server stores as UTC midnight (e.g. a task's
 * dueDate or a driver's hireDate typed as YYYY-MM-DD); not for real instants
 * (createdAt, attendance times), which should stay in the local zone.
 * A plain toLocaleDateString() would show UTC midnight as the evening before
 * in US zones. Returns '' for null, undefined or an invalid date, so callers
 * keep their own fallback.
 */
export function formatStoredDate(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { ...options, timeZone: 'UTC' });
}
