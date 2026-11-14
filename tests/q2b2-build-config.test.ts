// Q2b-2 / Q45: build-config guards. Source-text only, no DB.
// - vite.config.ts: no Replit plugin, and an explicit build.target that keeps
//   Safari 14 (vite 8 would otherwise default to iOS 16.4; the app supports
//   iOS 16.0).
// - package.json: the removed Replit plugins, zod-validation-error and
//   @tailwindcss/vite stay removed.
// - Capacitor coupling: core/cli/ios/android pinned to one exact version, and
//   once core is past 8.5.1 the keyboard must be >= 8.0.3 (8.0.2 replaces
//   Capacitor's Android insets listener: content under the status/nav bar).
// (client/index.html is guarded by tests/q58-no-third-party-script.test.ts.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
const pkgText = readFileSync(resolve(root, 'package.json'), 'utf8');
const pkg = JSON.parse(pkgText) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const allDeps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

// Drop // line comments and /* */ blocks, so a commented-out line doesn't count.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type Ver = [number, number, number];
const parseVer = (v: string): Ver => {
  const m = v.trim().replace(/^[\^~]/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`unparseable version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const cmpVer = (a: string, b: string) => {
  const x = parseVer(a);
  const y = parseVer(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

describe('Q2b-2 vite.config.ts', () => {
  it('has no @replit plugin', () => {
    expect(viteConfig).not.toMatch(/@replit/i);
  });

  it('sets build.target that includes safari14 (vite 8 defaults to iOS 16.4; app supports iOS 16.0)', () => {
    expect(stripComments(viteConfig)).toMatch(/target:\s*\[[^\]]*['"]safari14['"]/);
  });
});

describe('Q2b-2 package.json removals', () => {
  it('has no @replit/ dependency', () => {
    expect(pkgText).not.toMatch(/@replit\//);
  });

  it('has no zod-validation-error', () => {
    expect(pkgText).not.toMatch(/zod-validation-error/);
  });

  it('has no @tailwindcss/vite', () => {
    expect(pkgText).not.toMatch(/@tailwindcss\/vite/);
  });
});

describe('Q45 Capacitor coupling', () => {
  it('compares versions numerically, not as strings (8.10.0 > 8.5.1)', () => {
    expect(cmpVer('8.10.0', '8.5.1')).toBeGreaterThan(0);
    expect(cmpVer('^8.0.3', '8.0.3')).toBe(0);
    expect(cmpVer('8.0.2', '8.0.3')).toBeLessThan(0);
  });

  it('core, cli, ios and android are the same exact version (no ^ or ~)', () => {
    const names = ['@capacitor/core', '@capacitor/cli', '@capacitor/ios', '@capacitor/android'];
    const versions = names.map((n) => allDeps[n]);
    for (const v of versions) {
      expect(v).toBeDefined();
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(new Set(versions).size).toBe(1);
  });

  it('if core > 8.5.1 then @capacitor/keyboard >= 8.0.3 (the Q2a Android insets bug)', () => {
    const core = allDeps['@capacitor/core'];
    const keyboard = allDeps['@capacitor/keyboard'];
    expect(keyboard).toBeDefined();
    if (cmpVer(core, '8.5.1') > 0) {
      expect(cmpVer(keyboard, '8.0.3')).toBeGreaterThanOrEqual(0);
    }
  });
});
