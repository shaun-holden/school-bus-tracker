import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { queryClient } from '../client/src/lib/queryClient';

// Q9a / checklist P-4: no global short refetchInterval. Every live query opts in
// explicitly (policy comment at the top of client/src/lib/queryClient.ts).

const CLIENT_SRC = path.resolve(__dirname, '../client/src');
const MIN_INTERVAL_MS = 15000;

// Short-lived onboarding status screens may poll faster than the floor.
// Exempt by file name (relative to client/src); nothing else is.
const ONBOARDING_ALLOW_LIST = new Set([
  'pages/onboarding-success.tsx', // 5 s: waits for Stripe checkout to land
  'pages/onboarding-pending.tsx', // 10 s: waits for master-admin approval
  'App.tsx', // 10 s: PendingCompanyGate, the same pending-approval status poll
]);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('client polling defaults', () => {
  it('the global default does not poll (refetchInterval === false)', () => {
    expect(queryClient.getDefaultOptions().queries?.refetchInterval).toBe(false);
  });

  it('keeps refetch-on-focus as the default way lists stay fresh', () => {
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
  });

  it(`no refetchInterval in client/src is below ${MIN_INTERVAL_MS} ms (onboarding allow-list excepted)`, () => {
    const tooShort: string[] = [];
    let found = 0;
    for (const file of listSourceFiles(CLIENT_SRC)) {
      const rel = path.relative(CLIENT_SRC, file).split(path.sep).join('/');
      if (ONBOARDING_ALLOW_LIST.has(rel)) continue;
      const text = fs.readFileSync(file, 'utf8');
      // Check every number in the value expression, so `isOnDuty ? 30000 : false`
      // is covered as well as a plain literal.
      for (const m of text.matchAll(/refetchInterval:\s*([^,\n}]+)/g)) {
        for (const num of m[1].matchAll(/\b[0-9][0-9_]*\b/g)) {
          found++;
          const ms = Number(num[0].replace(/_/g, ''));
          if (ms < MIN_INTERVAL_MS) tooShort.push(`${rel}: ${ms}`);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
    expect(tooShort).toEqual([]);
  });

  it('every allow-listed file exists, so a rename cannot silently widen the exemption', () => {
    for (const rel of ONBOARDING_ALLOW_LIST) {
      expect(fs.existsSync(path.join(CLIENT_SRC, rel)), rel).toBe(true);
    }
  });
});
