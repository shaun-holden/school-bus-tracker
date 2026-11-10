import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { queryClient } from '../client/src/lib/queryClient';

// Q9a / checklist P-4: no global short refetchInterval. Every live query opts in
// explicitly (policy comment at the top of client/src/lib/queryClient.ts).

const CLIENT_SRC = path.resolve(__dirname, '../client/src');
const MIN_INTERVAL_MS = 5000;

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

  it(`no refetchInterval in client/src is below ${MIN_INTERVAL_MS} ms`, () => {
    const tooShort: string[] = [];
    let found = 0;
    for (const file of listSourceFiles(CLIENT_SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/refetchInterval:\s*([0-9_]+)/g)) {
        found++;
        const ms = Number(m[1].replace(/_/g, ''));
        if (ms < MIN_INTERVAL_MS) tooShort.push(`${path.relative(CLIENT_SRC, file)}: ${ms}`);
      }
    }
    expect(found).toBeGreaterThan(0);
    expect(tooShort).toEqual([]);
  });
});
