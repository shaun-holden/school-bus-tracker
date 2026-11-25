import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Q169: the admin link-code box's "max uses" and "expires in days" number boxes
// must keep what the admin types (clear and retype), not snap back to 2 / 7.
// No React test harness here (no jsdom), so this scans the component source.
// Each match is anchored to the input's own data-testid block.
const SRC = readFileSync(
  new URL('../client/src/components/admin/LinkCodeManager.tsx', import.meta.url),
  'utf8',
);

// The <Input ...> element that carries the given data-testid.
function inputBlock(testId: string): string {
  const at = SRC.indexOf(`data-testid="${testId}"`);
  expect(at, `no input with data-testid="${testId}"`).toBeGreaterThan(-1);
  const start = SRC.lastIndexOf('<Input', at);
  const end = SRC.indexOf('/>', at);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(at);
  return SRC.slice(start, end);
}

describe('Q169 link-code number boxes keep the typed text', () => {
  it('no number box parses on change with a "|| default" fallback (red if a number box snaps back to a default on change)', () => {
    expect(SRC).not.toMatch(/parseInt\(\s*e\.target\.value\s*\)\s*\|\|/);
  });

  for (const [testId, setter] of [
    ['input-max-uses', 'setMaxUsesText'],
    ['input-expires-days', 'setExpiresInDaysText'],
  ] as const) {
    it(`${testId} onChange stores the raw e.target.value (red if a number box snaps back to a default on change)`, () => {
      const block = inputBlock(testId);
      expect(block).toContain('type="number"');
      const onChange = block.match(/onChange=\{\(e\) => ([^}]*)\}/);
      expect(onChange, `${testId} has no onChange`).not.toBeNull();
      expect(onChange![1].trim()).toBe(`${setter}(e.target.value)`);
    });
  }

  it('Generate is disabled while either box is invalid (red if the inputsValid gate is removed from the button)', () => {
    const at = SRC.indexOf('data-testid="button-generate-code"');
    expect(at).toBeGreaterThan(-1);
    const button = SRC.slice(SRC.lastIndexOf('<Button', at), at);
    expect(button).toMatch(/disabled=\{[^}]*!inputsValid[^}]*\}/);
    expect(SRC).toMatch(/const inputsValid = maxUses !== null && expiresInDays !== null;/);
    expect(SRC).toMatch(/parseBoxedInt\(maxUsesText, 1, 5\)/);
    expect(SRC).toMatch(/parseBoxedInt\(expiresInDaysText, 1, 30\)/);
  });
});
