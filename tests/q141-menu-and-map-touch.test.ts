import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Q141: on an iPhone the page froze (no scroll, no tap) until a refresh. The
// suite has no DOM setup, so these are source scans of the guards that stop
// the menus and the bus map from locking the page.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const NAV = read('client/src/components/shared/Navigation.tsx');
const MAP = read('client/src/components/shared/BusTrackingMap.tsx');
const MAIN = read('client/src/main.tsx');

describe('Q141: menus and the bus map never lock the page on phones', () => {
  it('(a) both Navigation <DropdownMenu> roots have modal={false} (no body pointer-events / scroll lock)', () => {
    // `<DropdownMenu` followed by a space or `>` only: not DropdownMenuItem, DropdownMenuContent, …
    const roots = NAV.match(/<DropdownMenu(?=[\s>])[^>]*>/g) ?? [];
    expect(roots, 'exactly 2 DropdownMenu roots (View As + phone ☰)').toHaveLength(2);
    roots.forEach((tag, i) => {
      expect(tag, `DropdownMenu root #${i + 1}`).toContain('modal={false}');
    });
  });

  it('(b) the BusTrackingMap wrapper is relative + isolate (Leaflet z-indexes stay under the top bar)', () => {
    const wrapper = MAP.match(/<div style=\{\{ height, width: '100%' \}\} className="([^"]*)"/);
    expect(wrapper, 'map wrapper div').not.toBeNull();
    const classes = wrapper![1].split(/\s+/);
    expect(classes).toContain('relative');
    expect(classes.includes('isolate') || classes.includes('z-0')).toBe(true);
  });

  it('(c) MapContainer has dragging={!L.Browser.mobile} and scrollWheelZoom={false} (a swipe scrolls the page)', () => {
    const container = MAP.match(/<MapContainer[\s\S]*?>/);
    expect(container, 'MapContainer tag').not.toBeNull();
    expect(container![0]).toContain('dragging={!L.Browser.mobile}');
    expect(container![0]).toContain('scrollWheelZoom={false}');
  });

  it("(d) MapBoundsUpdater's effect deps don't contain the bare buses array (no refit on every poll)", () => {
    const start = MAP.indexOf('function MapBoundsUpdater');
    expect(start, 'MapBoundsUpdater').toBeGreaterThan(-1);
    const end = MAP.indexOf('\nfunction ', start + 1);
    const body = MAP.slice(start, end === -1 ? undefined : end);
    const deps = [...body.matchAll(/\}, \[([^\]]*)\]\);/g)].map((m) => m[1]);
    expect(deps.length, 'at least one effect in MapBoundsUpdater').toBeGreaterThan(0);
    for (const d of deps) {
      const names = d.split(',').map((s) => s.trim());
      expect(names).not.toContain('buses');
    }
  });

  it('(e) main.tsx reloads a page restored from the back-forward cache (pageshow + persisted), web only', () => {
    const branch = MAIN.match(/if \(!Capacitor\.isNativePlatform\(\)\) \{([\s\S]*?)\n\}/);
    expect(branch, 'web-only branch in main.tsx').not.toBeNull();
    const body = branch![1];
    expect(body).toMatch(/addEventListener\(\s*["']pageshow["']/);
    expect(body).toMatch(/\.persisted\)\s*window\.location\.reload\(\)/);
  });
});
