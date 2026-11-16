// Q88 + Q89 client: source-text checks (unit, no DB, no DOM).
// Q88: the parent notice list mixes rows from two tables, so list keys carry
//      the row's source as well as its id.
// Q89: the admin route edit dialog sends only the fields it edits.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const ADMIN = read('client/src/pages/admin-dashboard.tsx');
const NOTICES = read('client/src/components/parent/NotificationCenter.tsx');

/** Text between a unique start phrase and the first end phrase after it. */
function between(src: string, start: string, end: string): string {
  const first = src.indexOf(start);
  expect(first, `start anchor not found: ${start}`).toBeGreaterThanOrEqual(0);
  expect(src.indexOf(start, first + 1), `start anchor is not unique: ${start}`).toBe(-1);
  const stop = src.indexOf(end, first);
  expect(stop, `end anchor not found after start: ${end}`).toBeGreaterThan(first);
  return src.slice(first, stop);
}

// From the mutation's declaration to its onSuccess: the whole mutationFn,
// with // comments stripped (the explanatory comment names the dropped keys).
const editMutationFn = () =>
  between(ADMIN, 'const editRouteMutation = useMutation({', 'onSuccess:')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

describe('Q89 editRouteMutation sends only what the dialog edits', () => {
  it('sends no driverId (red if `driverId: null` is put back: it clears the route driver)', () => {
    expect(editMutationFn()).not.toMatch(/\bdriverId\s*:/);
  });

  it('sends no isActive (red if `isActive: true` is put back: it reactivates an inactive route)', () => {
    expect(editMutationFn()).not.toMatch(/\bisActive\s*:/);
  });

  it('sends no estimatedDuration or schoolId (red if either key is put back in the PATCH body)', () => {
    const fn = editMutationFn();
    expect(fn).not.toMatch(/\bestimatedDuration\s*:/);
    expect(fn).not.toMatch(/\bschoolId\s*:/);
  });

  it('maps "unassigned" (and empty) busNumber to null (red if busNumber is sent unmapped)', () => {
    const line = editMutationFn().split('\n').find((l) => /\bbusNumber\s*:/.test(l));
    expect(line, 'busNumber key missing from the PATCH body').toBeDefined();
    expect(line).toMatch(/["']unassigned["']/);
    expect(line).toMatch(/\bnull\b/);
  });

  it('still sends name and description', () => {
    const fn = editMutationFn();
    expect(fn).toMatch(/\bname\s*:\s*updateData\.name/);
    expect(fn).toMatch(/\bdescription\s*:\s*updateData\.description \|\| null/);
  });

  it("no longer logs the route body (red if console.log('Updating route:' is put back)", () => {
    expect(ADMIN).not.toContain("console.log('Updating route:'");
  });

  it('the edit dialog bus Select shows "Unassigned" for a route with no bus', () => {
    const select = between(ADMIN, 'data-testid="edit-select-bus-number"', '</Select>');
    // The Select's value prop sits just before the trigger: look back from the testid.
    const at = ADMIN.indexOf('data-testid="edit-select-bus-number"');
    const before = ADMIN.slice(Math.max(0, at - 400), at);
    expect(before).toContain("value={field.value || 'unassigned'}");
    expect(select).toContain('<SelectItem value="unassigned">Unassigned</SelectItem>');
  });
});

describe('Q88 NotificationCenter keys rows by source and id', () => {
  it('declares an optional source on Notification', () => {
    expect(NOTICES).toMatch(/source\?\s*:\s*'parent'\s*\|\s*'system'/);
  });

  it("keys each list row by `${source ?? 'parent'}:${id}` (red if the key is notification.id alone)", () => {
    expect(NOTICES).toContain("key={`${notification.source ?? 'parent'}:${notification.id}`}");
    expect(NOTICES).not.toContain('key={notification.id}');
  });
});
