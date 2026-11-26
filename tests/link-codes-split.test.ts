import { describe, it, expect } from 'vitest';
import { splitLinkCodes } from '../client/src/lib/linkCodes';

// Q188 (d): the link-code list shows only current codes; everything else is
// "old" and folds under "Show old codes (N)". A behaviour test, so oldCodes can
// never silently include an active code.
const NOW = new Date('2026-11-26T12:00:00.000Z');
const FUTURE = '2026-12-03T12:00:00.000Z';
const PAST = '2026-11-20T12:00:00.000Z';

const fixtures = [
  { id: 'active-future', status: 'active', expiresAt: FUTURE },
  { id: 'active-past', status: 'active', expiresAt: PAST },
  { id: 'revoked', status: 'revoked', expiresAt: FUTURE },
  { id: 'used', status: 'used', expiresAt: FUTURE },
  { id: 'expired', status: 'expired', expiresAt: PAST },
];

describe('splitLinkCodes', () => {
  it('active = only the active code before its expiry; old = the other 4 (red if old codes include an active code)', () => {
    const { active, old } = splitLinkCodes(fixtures, NOW);
    expect(active.map((c) => c.id)).toEqual(['active-future']);
    expect(old.map((c) => c.id)).toEqual(['active-past', 'revoked', 'used', 'expired']);
    expect(active.length + old.length).toBe(fixtures.length);
    const activeIds = new Set(active.map((c) => c.id));
    expect(old.some((c) => activeIds.has(c.id))).toBe(false);
  });

  it('an active code exactly at its expiry time counts as old (red if the expiry check is loosened)', () => {
    const atNow = [{ id: 'edge', status: 'active', expiresAt: NOW.toISOString() }];
    const { active, old } = splitLinkCodes(atNow, NOW);
    expect(active).toEqual([]);
    expect(old.map((c) => c.id)).toEqual(['edge']);
  });

  it('an empty list splits into two empty lists', () => {
    expect(splitLinkCodes([], NOW)).toEqual({ active: [], old: [] });
  });
});
