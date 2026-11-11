import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Q31: with ios.contentInset 'never' (Q30) the CSS env(safe-area-inset-*) values
// are the only inset. Source scans (the suite has no DOM setup).

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const NO_NAV_PAGES = [
  'auth', 'business-signup', 'driver-password-setup', 'landing', 'master-admin-dashboard',
  'not-found', 'onboarding-pending', 'onboarding-plans', 'onboarding-success', 'privacy',
  'reset-password', 'role-selection', 'support',
];
const NAV_PAGES = ['admin-dashboard', 'driver-dashboard', 'parent-dashboard', 'parent-notifications'];

const page = (name: string) => read(`client/src/pages/${name}.tsx`);
const classNames = (src: string) => [...src.matchAll(/className="([^"]*)"/g)].map((m) => m[1].split(/\s+/));

describe('safe-area CSS utilities (Q31)', () => {
  const css = read('client/src/index.css');
  const rule = (sel: string) => {
    const m = css.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`));
    expect(m, `${sel} rule`).not.toBeNull();
    return m![1];
  };

  it('.safe-area-page insets all four sides', () => {
    const r = rule('.safe-area-page');
    for (const side of ['top', 'right', 'bottom', 'left']) expect(r).toContain(`env(safe-area-inset-${side})`);
  });

  it('.safe-area-page-below-nav insets left/right/bottom but NOT top (Navigation owns the top)', () => {
    const r = rule('.safe-area-page-below-nav');
    for (const side of ['right', 'bottom', 'left']) expect(r).toContain(`env(safe-area-inset-${side})`);
    expect(r).not.toContain('safe-area-inset-top');
  });
});

describe('every page is covered (Q31)', () => {
  it.each(NO_NAV_PAGES)('%s (no Navigation) uses safe-area-page on a min-h-screen outer element (red if dropped)', (name) => {
    const src = page(name);
    expect(src).not.toContain('components/shared/Navigation');
    const outers = classNames(src).filter((c) => c.includes('min-h-screen'));
    expect(outers.length).toBeGreaterThan(0);
    for (const c of outers) expect(c, c.join(' ')).toContain('safe-area-page');
  });

  it.each(NAV_PAGES)('%s (renders Navigation) uses safe-area-page-below-nav, never the full top inset', (name) => {
    const src = page(name);
    expect(src).toContain('components/shared/Navigation');
    const all = classNames(src);
    expect(all.some((c) => c.includes('safe-area-page-below-nav'))).toBe(true);
    expect(all.some((c) => c.includes('safe-area-page'))).toBe(false);
    expect(src).not.toContain('safe-area-inset-top');
  });

  it('Navigation bleeds over the side insets so the bar is full width and not double-padded', () => {
    const nav = read('client/src/components/shared/Navigation.tsx');
    expect(nav).toContain("marginLeft: 'calc(-1 * env(safe-area-inset-left))'");
    expect(nav).toContain("marginRight: 'calc(-1 * env(safe-area-inset-right))'");
    expect(nav).toContain("paddingTop: 'env(safe-area-inset-top)'");
  });
});

describe('drawer and toast insets (Q31)', () => {
  it('DrawerContent pads the bottom inset (home indicator)', () => {
    expect(read('client/src/components/ui/drawer.tsx')).toContain('pb-[env(safe-area-inset-bottom)]');
  });

  it('the mobile toast viewport sits below the status bar, not at top-0', () => {
    const toast = read('client/src/components/ui/toast.tsx');
    expect(toast).toContain('top-[env(safe-area-inset-top)]');
    expect(toast).not.toMatch(/"fixed top-0 /);
  });
});

describe('role labels use formatRole (Q31)', () => {
  it('MessagingPortal prints both contact roles through formatRole', () => {
    const src = read('client/src/components/shared/MessagingPortal.tsx');
    expect(src).toContain('{formatRole(selectedContact.role)}');
    expect(src).toContain('{formatRole(contact.role)}');
    expect(src).not.toMatch(/>\s*\{(selectedContact|contact)\.role\}\s*</);
  });

  it('role-selection prints the current role through formatRole', () => {
    const src = page('role-selection');
    expect(src).toContain('formatRole((user as any).role)');
    expect(src).not.toMatch(/capitalize">\{\(user as any\)\.role\}/);
  });
});
