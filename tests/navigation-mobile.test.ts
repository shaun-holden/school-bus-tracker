import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Q28: on a phone (< 640 px, Tailwind `sm`) the top bar's right-hand controls
// sit in one overflow menu, so every role can reach Sign Out at 320 px. The
// suite has no DOM setup, so this is a source scan of Navigation.tsx.

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../client/src/components/shared/Navigation.tsx'),
  'utf8',
);

const DESKTOP_OPEN = '<div className="hidden sm:flex items-center space-x-2">';
const MOBILE_OPEN = '<div className="sm:hidden">';

function blocks() {
  const d = SRC.indexOf(DESKTOP_OPEN);
  const m = SRC.indexOf(MOBILE_OPEN);
  expect(d, 'desktop block (hidden sm:flex)').toBeGreaterThan(-1);
  expect(m, 'mobile block (sm:hidden)').toBeGreaterThan(-1);
  expect(m, 'mobile block follows the desktop block').toBeGreaterThan(d);
  return { desktop: SRC.slice(d, m), mobile: SRC.slice(m, SRC.indexOf('</nav>')) };
}

describe('Navigation top bar on mobile (Q28)', () => {
  it('the mobile menu (sm:hidden) has a Sign Out item wired to handleLogout (red if the mobile Sign Out is removed)', () => {
    const { mobile } = blocks();
    expect(mobile).toContain('aria-label="Menu"');
    expect(mobile).toContain('data-testid="button-logout-mobile"');
    expect(mobile).toMatch(/onClick=\{handleLogout\}[\s\S]*?Sign Out/);
  });

  it('the desktop block (hidden sm:flex) keeps its Sign Out button and testid', () => {
    const { desktop } = blocks();
    expect(desktop).toContain('data-testid="button-logout"');
    expect(desktop).toMatch(/onClick=\{handleLogout\}[\s\S]*?Sign Out/);
  });

  it('the theme toggle is reachable in both blocks', () => {
    const { desktop, mobile } = blocks();
    expect(desktop).toContain('onClick={toggleTheme}');
    expect(mobile).toContain('onClick={toggleTheme}');
  });

  it('role switchers are in the mobile menu too: master_admin views and admin Change Role', () => {
    const { mobile } = blocks();
    expect(mobile).toContain("user?.role === 'master_admin'");
    for (const target of ["'/admin'", "'/driver'", "'/parent'"]) expect(mobile).toContain(target);
    expect(mobile).toContain("user?.role === 'admin'");
    expect(mobile).toContain("'/select-role'");
  });

  it('one logout implementation: logout() is called only inside handleLogout', () => {
    expect(SRC.match(/\blogout\(\)/g)).toHaveLength(1);
    expect(SRC).toMatch(/const handleLogout = async \(\) => \{\s*return logout\(\);/);
  });

  it('no data-testid appears twice (only one copy of each control is in the DOM)', () => {
    const ids = [...SRC.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the title truncates instead of wrapping, and the safe-area padding stays', () => {
    expect(SRC).toMatch(/<h1 className="[^"]*\btruncate\b[^"]*">/);
    expect(SRC).toContain("paddingTop: 'env(safe-area-inset-top)'");
  });
});
