import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { formatRole } from '../client/src/lib/roleLabel';

// Q30: iOS layout after rotation, role badge label, 24 px menu icon.
// The suite has no DOM setup, so the layout guards are source scans.

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

describe('formatRole (Q30)', () => {
  it('maps every known role to its label (red if master_admin is not "Master Admin")', () => {
    expect(formatRole('master_admin')).toBe('Master Admin');
    expect(formatRole('driver_admin')).toBe('Driver Admin');
    expect(formatRole('admin')).toBe('Admin');
    expect(formatRole('driver')).toBe('Driver');
    expect(formatRole('parent')).toBe('Parent');
  });

  it('splits an unknown role on "_" and capitalizes each word', () => {
    expect(formatRole('camp_staff_lead')).toBe('Camp Staff Lead');
    expect(formatRole('')).toBe('');
    expect(formatRole(undefined)).toBe('');
  });
});

describe('iOS safe-area inset and overflow (Q30)', () => {
  const cap = read('capacitor.config.ts');
  const iosBlock = cap.slice(cap.indexOf('ios: {'), cap.indexOf('android: {'));

  it("capacitor ios.contentInset is not 'automatic' (red if the double native inset comes back)", () => {
    expect(iosBlock).toMatch(/contentInset:\s*'never'/);
    expect(iosBlock).not.toMatch(/contentInset:\s*'automatic'/);
  });

  it('html clips horizontal overflow; body is not made a scroll container (keeps sticky nav working)', () => {
    const css = read('client/src/index.css');
    expect(css).toMatch(/html\s*\{[^}]*overflow-x:\s*hidden/);
    expect(css).toMatch(/#root\s*\{[^}]*overflow-x:\s*clip/);
    expect(css).not.toMatch(/body\s*\{[^}]*overflow(-x)?:\s*hidden/);
  });
});

describe('Navigation (Q30)', () => {
  const nav = read('client/src/components/shared/Navigation.tsx');

  it('the role badge uses formatRole, not raw user.role with CSS capitalize', () => {
    expect(nav).toContain('{formatRole(user.role)}');
    expect(nav).not.toMatch(/>\s*\{user\.role\}\s*</);
    expect(nav).not.toMatch(/rounded-md capitalize/);
  });

  it('the mobile menu trigger overrides the 16 px svg size to 24 px and keeps a 44 px tap target', () => {
    const m = nav.match(/<Button[^>]*data-testid="button-mobile-menu"[^>]*>/);
    expect(m, 'mobile menu trigger').not.toBeNull();
    expect(m![0]).toContain('[&_svg]:size-6');
    expect(m![0]).toMatch(/\bh-11\b/);
    expect(m![0]).toMatch(/\bw-11\b/);
  });

  it('the nav pads all three safe-area sides (top, left, right) for landscape notch', () => {
    expect(nav).toContain("paddingTop: 'env(safe-area-inset-top)'");
    expect(nav).toContain("paddingLeft: 'env(safe-area-inset-left)'");
    expect(nav).toContain("paddingRight: 'env(safe-area-inset-right)'");
  });
});
