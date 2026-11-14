process.env.TZ = 'America/New_York'; // CI runs in UTC, where the bug can't show. Test 0 proves this took effect.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { localDateString, localDateStringPlusDays } from '../client/src/lib/localDate';

// Q55: the parent "Today" / "Tomorrow" absence date is the local day, not the UTC day.
afterEach(() => vi.useRealTimers());

// 20:30 Eastern on Nov 13 2026 is already Nov 14 in UTC.
const EVENING_NY = new Date('2026-11-14T01:30:00Z');

describe('Q55 localDate helpers (TZ America/New_York)', () => {
  it('0: the time zone took effect (EST offset 300 in November; red if the TZ line is removed)', () => {
    expect(new Date(Date.UTC(2026, 10, 14, 1, 30)).getTimezoneOffset()).toBe(300);
  });

  it('1: evening in New York is still today (red if the helper uses the UTC day)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(EVENING_NY);
    expect(localDateString()).toBe('2026-11-13');
  });

  it('2: tomorrow from that evening is the next local day (red if the helper uses the UTC day)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(EVENING_NY);
    expect(localDateStringPlusDays(1)).toBe('2026-11-14');
  });

  it('3: month and day are zero-padded YYYY-MM-DD (red if padStart is removed; the server rejects other shapes)', () => {
    const s = localDateString(new Date(2026, 0, 5, 9));
    expect(s).toBe('2026-01-05');
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('4: month end rolls over to the next month', () => {
    expect(localDateStringPlusDays(1, new Date(2026, 0, 31, 22))).toBe('2026-02-01');
  });

  it('DST: the evening before spring-forward stays on its own day, and tomorrow is the change day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-08T04:30:00Z')); // 23:30 EST Mar 7
    expect(localDateString()).toBe('2026-03-07');
    expect(localDateStringPlusDays(1)).toBe('2026-03-08');
  });
});

describe('Q55 ParentQuickActions uses the local-day helper', () => {
  const src = readFileSync(resolve(__dirname, '../client/src/components/parent/ParentQuickActions.tsx'), 'utf8');

  it('5: no toISOString date anywhere, and the helpers come from @/lib/localDate (red if any site is reverted)', () => {
    expect(src).not.toMatch(/toISOString/);
    expect(src).toMatch(/import \{ localDateString, localDateStringPlusDays \} from "@\/lib\/localDate";/);
    expect(src.match(/localDateString\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(src).toMatch(/localDateStringPlusDays\(1\)/);
  });

  it('the Report Absence dialog resets the date to today when it opens (stale mount-time default)', () => {
    expect(src).toMatch(/if \(open\) form\.setValue\("date", localDateString\(\)\);/);
  });
});
