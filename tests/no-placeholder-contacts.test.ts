import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Q24: no fake contact details in the UI. The real support address is
// support@schoolbustracker.org and there is no support phone number.
// Form hints are fine: anything inside a placeholder="..." (or
// placeholder={"..."} / placeholder={'...'}) attribute is ignored.

const CLIENT_SRC = path.resolve(__dirname, '../client/src');
const SUPPORT_EMAIL = 'support@schoolbustracker.org';

const EXAMPLE_DOMAIN = /\bexample\.com\b/i;
// (555) 000-0000, 555-123-4567, +1 555 000 0000, tel:+15550000000
const FAKE_555_PHONE = /\(?\b555\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+?1555\d{7}\b/;

function listTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsx(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function stripPlaceholders(text: string): string {
  return text
    .replace(/placeholder=\{?"[^"]*"\}?/g, 'placeholder=""')
    .replace(/placeholder=\{?'[^']*'\}?/g, "placeholder=''")
    .replace(/placeholder=\{`[^`]*`\}/g, 'placeholder=""');
}

function findHits(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of listTsx(CLIENT_SRC)) {
    const lines = stripPlaceholders(fs.readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${path.relative(CLIENT_SRC, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('no placeholder contacts in client/src (Q24)', () => {
  it('no example.com outside placeholder attributes', () => {
    expect(findHits(EXAMPLE_DOMAIN)).toEqual([]);
  });

  it('no fake 555 phone numbers outside placeholder attributes', () => {
    expect(findHits(FAKE_555_PHONE)).toEqual([]);
  });

  it('the scanner still sees example.com / 555 numbers that are not placeholders (self-check)', () => {
    const sample = stripPlaceholders(
      '<a href="mailto:x@example.com">+1 (555) 000-0000</a> <Input placeholder="you@example.com" />',
    );
    expect(EXAMPLE_DOMAIN.test(sample)).toBe(true);
    expect(FAKE_555_PHONE.test(sample)).toBe(true);
    expect(FAKE_555_PHONE.test('tel:+15550000000')).toBe(true);
    expect(EXAMPLE_DOMAIN.test(stripPlaceholders('<Input placeholder="you@example.com" />'))).toBe(false);
  });

  it('the pending page links the real support address and has no phone link', () => {
    const page = fs.readFileSync(path.join(CLIENT_SRC, 'pages/onboarding-pending.tsx'), 'utf8');
    expect(page).toContain(`mailto:${SUPPORT_EMAIL}`);
    expect(page).not.toMatch(/href="tel:/);
  });
});
