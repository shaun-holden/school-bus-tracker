import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Q177: an archived route says Archived. Q179: one "No bus assigned" phrase
// on the parent cards. Q189: the admin dashboard prints no data to the
// browser console. No React test harness (no jsdom), so these scan the source;
// the badge checks are anchored to the Badge tag, the log checks are
// file-wide on purpose.
const read = (rel: string) => readFileSync(new URL(`../client/src/${rel}`, import.meta.url), 'utf8');
const ADMIN = read('pages/admin-dashboard.tsx');
const STATUS_CARD = read('components/parent/StudentStatusCard.tsx');
const TRACKING_CARD = read('components/parent/LiveTrackingCard.tsx');

// From an opening tag that contains `marker` to its closing tag.
function elementWith(src: string, marker: string, close: string): string {
  const at = src.indexOf(marker);
  expect(at, `no ${marker}`).toBeGreaterThan(-1);
  const start = src.lastIndexOf('<', at);
  const end = src.indexOf(close, at);
  expect(end, `no ${close} after ${marker}`).toBeGreaterThan(at);
  return src.slice(start, end + close.length);
}

describe('Q177 archived route badge', () => {
  it("the Routes-table badge says 'Archived' when isActive === false, never 'Inactive' (red if 'Inactive' comes back)", () => {
    const badge = elementWith(ADMIN, '<Badge variant={route.isActive', '</Badge>');
    expect(badge).toMatch(/route\.isActive === false \? 'secondary' : 'default'/);
    expect(badge).toMatch(/route\.isActive === false \? 'Archived' : 'Active'/);
    expect(badge).not.toMatch(/Inactive/);
  });

  it("the driver card's assigned-route Status says 'Archived' when isActive === false (red if it says Inactive again)", () => {
    // The label is the text-node line `{assignedRoute.isActive … }` (the
    // className line above it has `${assignedRoute.isActive`).
    const label = ADMIN.match(/^\s*\{assignedRoute\.isActive[^\n]*$/m);
    expect(label, 'no assignedRoute status label line').not.toBeNull();
    expect(label![0]).toMatch(/assignedRoute\.isActive === false \? 'Archived' : 'Active'/);
    const cls = ADMIN.match(/\$\{assignedRoute\.isActive[^}]*\}/);
    expect(cls![0]).toMatch(/assignedRoute\.isActive === false \? 'bg-gray-100/);
    expect(ADMIN).not.toMatch(/assignedRoute\.isActive \? 'Active' : 'Inactive'/);
  });
});

describe('Q179 one "No bus assigned" phrase', () => {
  it('both parent cards say "No bus assigned", and neither old phrase is left (red if "Bus not assigned" comes back)', () => {
    for (const [name, src] of [['StudentStatusCard', STATUS_CARD], ['LiveTrackingCard', TRACKING_CARD]] as const) {
      expect(src, name).toContain('No bus assigned');
      expect(src, name).not.toMatch(/Bus not assigned/i);
      expect(src, name).not.toMatch(/No bus currently assigned/i);
      expect(src, name).not.toContain('No Bus Assigned');
    }
    expect(TRACKING_CARD).toContain('No bus information available for your children.');
  });
});

describe('Q189 admin dashboard console', () => {
  it('admin-dashboard.tsx has no console.log( and every console.error( takes one string literal (red if a data log comes back)', () => {
    expect(ADMIN).not.toMatch(/console\.(log|info|debug|warn)\(/);
    const calls = ADMIN.match(/console\.error\([^)]*\)/g) ?? [];
    // Non-vacuous: the file has many error logs today (21).
    expect(calls.length).toBeGreaterThan(10);
    for (const call of calls) {
      expect(call).toMatch(/^console\.error\(\s*"[^"]*"\s*\)$/);
    }
    // Every console.error( opener is a full call matched above (none with a
    // nested ")" that the scan would cut short).
    expect((ADMIN.match(/console\.error\(/g) ?? []).length).toBe(calls.length);
  });

  it('the Bus Assignment Select still returns its "No buses available" item after the render-time logs went (red if the IIFE body is broken)', () => {
    const at = ADMIN.indexOf('const availableBuses = buses.filter(');
    expect(at).toBeGreaterThan(-1);
    const body = ADMIN.slice(at, at + 1200);
    expect(body).toMatch(/if \(availableBuses\.length === 0\) \{\s*return \(/);
    expect(body).toContain('No buses available for assignment');
  });
});
