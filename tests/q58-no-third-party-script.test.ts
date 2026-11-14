// Q58: client/index.html must not load a third-party script. The old Replit
// dev banner (https://replit.com/public/js/replit-dev-banner.js) shipped in the
// production web build and the bundled iOS/Android apps, running a third
// party's code on the same origin as the session cookie. Source-text, no DB.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(__dirname, '../client/index.html'), 'utf8');

describe('Q58 client/index.html has no third-party script', () => {
  it('contains no "replit" (case-insensitive)', () => {
    expect(html).not.toMatch(/replit/i);
  });

  it('has no <script> whose src starts with http:, https: or //', () => {
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0); // the module script below
    const external = srcs.filter((s) => /^(https?:|\/\/)/i.test(s.trim()));
    expect(external).toEqual([]);
  });

  it('still has the /src/main.tsx module script line exactly (server/vite.ts rewrites this text)', () => {
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
  });
});
