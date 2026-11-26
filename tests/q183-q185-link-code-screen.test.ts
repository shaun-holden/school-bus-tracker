import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Q183-Q185: the link-code screen fits phones, its button is labelled, and
// old codes are folded under a toggle. Plus the admin's student Delete toast
// shows the server's message. No React test harness (no jsdom), so this
// scans the source; every match is anchored to a test id or a sliced block.
const LCM = readFileSync(
  new URL('../client/src/components/admin/LinkCodeManager.tsx', import.meta.url),
  'utf8',
);
const ADMIN = readFileSync(
  new URL('../client/src/pages/admin-dashboard.tsx', import.meta.url),
  'utf8',
);

// The JSX element that opens on the line carrying `marker`, up to its matching
// closing tag (counts <tag ...> / </tag> of the same name; self-closing skipped).
function elementAt(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `no ${marker}`).toBeGreaterThan(-1);
  const start = src.lastIndexOf('<', at);
  const tag = /^<([A-Za-z]+)/.exec(src.slice(start))![1];
  const re = new RegExp(`<${tag}\\b[^>]*?(/?)>|</${tag}>`, 'g');
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('</')) depth--;
    else if (m[1] !== '/') depth++;
    if (depth === 0) return src.slice(start, re.lastIndex);
  }
  throw new Error(`unclosed <${tag}> at ${marker}`);
}

describe('Q183 the generate row fits phones', () => {
  it('the generate row wraps and the hint is not inside it (red if the row stops wrapping or the hint moves back into it)', () => {
    const row = elementAt(LCM, 'data-testid="row-generate-link-code"');
    const open = row.slice(0, row.indexOf('>') + 1);
    expect(open).toMatch(/className="[^"]*\bflex-wrap\b[^"]*"/);
    expect(open).not.toMatch(/space-x-/);
    expect(row).toContain('data-testid="button-generate-code"');
    expect(row).not.toContain('text-link-code-input-hint');
    expect(row).not.toContain('Max uses must be 1 to 5 and days 1 to 30.');
    // The hint still exists, right after the row.
    const after = LCM.slice(LCM.indexOf(row) + row.length, LCM.indexOf(row) + row.length + 400);
    expect(after).toContain('data-testid="text-link-code-input-hint"');
  });

  it('the Parent Linking dialog keeps a side gap on phones (red if the dialog runs edge to edge again)', () => {
    const btn = LCM.slice(LCM.indexOf('export function LinkCodeButton'));
    expect(btn).toMatch(/<DialogContent className="[^"]*w-\[calc\(100%-2rem\)\][^"]*"/);
  });
});

describe('Q184 the link-code button is labelled', () => {
  it('the trigger has aria-label and visible "Link code" text (red if the button goes back to an unlabelled icon)', () => {
    const btn = LCM.slice(LCM.indexOf('export function LinkCodeButton'));
    const trigger = elementAt(btn, 'data-testid={`button-manage-link-${student.id}`}');
    expect(trigger).toMatch(/aria-label="Link code"/);
    expect(trigger).toMatch(/<span[^>]*>Link code<\/span>/);
    expect(trigger).not.toMatch(/className="[^"]*\bhidden\b/);
  });
});

describe('Q185 old codes folded under a toggle', () => {
  it('the visible list renders activeCodes; old codes only behind a toggle that starts closed (red if revoked/expired codes show by default)', () => {
    expect(LCM).toMatch(/const \[showOldCodes, setShowOldCodes\] = useState\(false\);/);
    expect(LCM).toMatch(/renderCodeTable\(activeCodes, "table-active-codes"\)/);
    expect(LCM).toMatch(/\{showOldCodes && renderCodeTable\(oldCodes, "table-old-codes"\)\}/);
    // No other place renders the full list or the old list.
    expect(LCM).not.toMatch(/linkCodes\.map\(/);
    expect(LCM.match(/renderCodeTable\(oldCodes/g)?.length).toBe(1);
    const toggle = elementAt(LCM, 'data-testid="button-toggle-old-codes"');
    expect(toggle).toContain('Show old codes (${oldCodes.length})');
    // The toggle sits inside the "only when there are old codes" block.
    const toggleAt = LCM.indexOf('data-testid="button-toggle-old-codes"');
    const guardAt = LCM.lastIndexOf('{oldCodes.length > 0 && (', toggleAt);
    expect(guardAt).toBeGreaterThan(LCM.indexOf('renderCodeTable(activeCodes'));
    expect(toggleAt - guardAt).toBeLessThan(400);
  });
});

describe('Delete toast shows the server message', () => {
  it('deleteStudentMutation.onError uses studentErrorText (red if the Delete toast shows the raw error again)', () => {
    const start = ADMIN.indexOf('const deleteStudentMutation = ');
    expect(start).toBeGreaterThan(-1);
    const mut = ADMIN.slice(start, ADMIN.indexOf('\n  });\n', start));
    const onError = mut.slice(mut.indexOf('onError:'));
    expect(onError).toMatch(/description: studentErrorText\(error, "Failed to delete student"\)/);
    expect(onError).not.toMatch(/description: error\?\.message/);
  });
});
