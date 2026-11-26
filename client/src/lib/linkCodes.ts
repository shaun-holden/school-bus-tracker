// Q188: split a student's link codes into the current ones and the old ones.
// active = status 'active' and not yet past expiresAt; old = everything else
// (revoked, used, expired, or 'active' but past its date). Pure, so it is
// unit-tested with fixtures (tests/link-codes-split.test.ts).
export interface SplittableLinkCode {
  id: string;
  status: string;
  expiresAt: string | Date;
}

export function splitLinkCodes<T extends SplittableLinkCode>(
  codes: T[],
  now: Date = new Date(),
): { active: T[]; old: T[] } {
  const active = codes.filter(
    (c) => c.status === 'active' && new Date(c.expiresAt) > now,
  );
  const old = codes.filter((c) => !active.includes(c));
  return { active, old };
}
