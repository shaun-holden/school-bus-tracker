import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Q194: every Dialog scrolls on a short screen. Q195: the admin Students
// table on a phone. Q196: no Parent ID box. No React test harness (no jsdom),
// so these scan the source; every match is anchored to a declaration, a
// dialog block, a test id or a component tag, never the whole file.
const SRC = readFileSync(new URL('../client/src/pages/admin-dashboard.tsx', import.meta.url), 'utf8');
const DIALOG = readFileSync(new URL('../client/src/components/ui/dialog.tsx', import.meta.url), 'utf8');

// From a dialog's {/* … */} comment to the next {/* … Dialog */} comment.
function dialogBlock(comment: string): string {
  const start = SRC.indexOf(`{/* ${comment} */}`);
  expect(start, `no "${comment}" comment`).toBeGreaterThan(-1);
  const rest = SRC.slice(start + comment.length + 6);
  const next = rest.search(/\{\/\* [^*]*Dialog \*\/\}/);
  expect(next, `no dialog comment after "${comment}"`).toBeGreaterThan(-1);
  return SRC.slice(start, start + comment.length + 6 + next);
}

// The Students table: from the Name header to the empty-row colSpan.
function studentsTable(): string {
  const start = SRC.indexOf('data-testid={`student-name-${student.id}`}');
  expect(start, 'no student-name cell').toBeGreaterThan(-1);
  const head = SRC.lastIndexOf('<TableHeader>', start);
  const end = SRC.indexOf('</Table>', start);
  expect(head).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(head, end);
}

describe('Q194 dialogs scroll', () => {
  it('ui/dialog.tsx DialogPrimitive.Content base class has max-h- and overflow-y-auto (red if the height cap is removed)', () => {
    const at = DIALOG.indexOf('<DialogPrimitive.Content');
    expect(at).toBeGreaterThan(-1);
    const cls = DIALOG.slice(at).match(/className=\{cn\(\s*"([^"]*)"/);
    expect(cls, 'no cn("…") className on DialogPrimitive.Content').not.toBeNull();
    expect(cls![1]).toMatch(/(^|\s)max-h-\[90dvh\](\s|$)/);
    expect(cls![1]).toMatch(/(^|\s)overflow-y-auto(\s|$)/);
  });
});

describe('Q195 Students table on a phone', () => {
  it('the Name header and cell are sticky left-0 with a background (red if the name scrolls away)', () => {
    const table = studentsTable();
    const th = table.match(/<TableHead\b[^>]*>Name<\/TableHead>/);
    expect(th, 'no Name TableHead').not.toBeNull();
    for (const c of ['sticky', 'left-0', 'z-10', 'bg-background']) expect(th![0]).toContain(c);

    const cellAt = table.indexOf('data-testid={`student-name-${student.id}`}');
    const cell = table.slice(table.lastIndexOf('<TableCell', cellAt), cellAt);
    for (const c of ['sticky', 'left-0', 'z-10', 'bg-background']) expect(cell).toContain(c);
  });

  it('Actions is the 2nd column, right after Name, in the header and the row (red if Actions goes back last)', () => {
    const table = studentsTable();
    const heads = [...table.matchAll(/<TableHead\b[^>]*>([^<]*)<\/TableHead>/g)].map((m) => m[1]);
    expect(heads).toEqual(['Name', 'Actions', 'Grade', 'School', 'Route', 'Status']);

    // In the row: the cell after the name cell holds the Edit/Delete buttons.
    const nameAt = table.indexOf('data-testid={`student-name-${student.id}`}');
    const nameEnd = table.indexOf('</TableCell>', nameAt);
    const nextCellAt = table.indexOf('<TableCell', nameEnd);
    const nextCell = table.slice(nextCellAt, table.indexOf('</TableCell>', nextCellAt));
    expect(nextCell).toContain('data-testid={`button-edit-student-${student.id}`}');
    expect(nextCell).toContain('data-testid={`button-delete-student-${student.id}`}');
    expect(table).toMatch(/colSpan=\{6\}/);
  });

  it('the TabsList is md:sticky md:top-16, not a bare sticky (red if the tab bar pins over the cards on phones)', () => {
    const tags = SRC.match(/<TabsList\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    const main = tags.find((t) => /top-16/.test(t));
    expect(main, 'no TabsList with top-16').toBeDefined();
    const cls = main!.match(/className="([^"]*)"/)![1].split(/\s+/);
    expect(cls).toContain('md:sticky');
    expect(cls).toContain('md:top-16');
    expect(cls).not.toContain('sticky');
    expect(cls).not.toContain('top-16');
  });
});

describe('Q196 no Parent ID box', () => {
  it('neither Student dialog has a parentId field (red if the Parent ID box comes back)', () => {
    for (const name of ['Add Student Dialog', 'Edit Student Dialog']) {
      const dlg = dialogBlock(name);
      expect(dlg, name).toMatch(/name="grade"/);
      expect(dlg, name).not.toMatch(/name="parentId"/);
      expect(dlg, name).not.toMatch(/Parent ID/);
    }
  });

  it('studentSchema has no parentId, and no form default or reset sets it (red if the hidden required field comes back)', () => {
    const start = SRC.indexOf('const studentSchema = z.object({');
    expect(start).toBeGreaterThan(-1);
    const schema = SRC.slice(start, SRC.indexOf('});', start));
    expect(schema).toMatch(/firstName:/);
    expect(schema).not.toMatch(/parentId/);
    expect(SRC).not.toMatch(/demo-parent-id/);
    const edit = SRC.slice(SRC.indexOf('const handleEditStudent = '), SRC.indexOf('const handleDeleteStudent = '));
    expect(edit).toMatch(/editStudentForm\.reset\(/);
    expect(edit).not.toMatch(/parentId/);
  });
});
