import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Q180: admins can mark a student inactive from Edit Student, and Delete
// offers "Mark inactive instead" before a permanent delete.
// No React test harness here (no jsdom), so this scans the page source.
// "isActive" and "Switch" appear many times in admin-dashboard.tsx, so every
// match is anchored to a dialog block or a unique data-testid.
const SRC = readFileSync(
  new URL('../client/src/pages/admin-dashboard.tsx', import.meta.url),
  'utf8',
);

// From a dialog's {/* … */} comment to the next {/* … Dialog */} comment.
function dialogBlock(comment: string): string {
  const start = SRC.indexOf(`{/* ${comment} */}`);
  expect(start, `no "${comment}" comment`).toBeGreaterThan(-1);
  const rest = SRC.slice(start + comment.length + 6);
  const next = rest.search(/\{\/\* [^*]*Dialog \*\/\}/);
  expect(next, `no dialog comment after "${comment}"`).toBeGreaterThan(-1);
  return SRC.slice(start, start + comment.length + 6 + next);
}

// The body of `const <name> = …` up to the next top-level "  const " / "  // " declaration.
function declBlock(name: string): string {
  const start = SRC.indexOf(`const ${name} = `);
  expect(start, `no const ${name}`).toBeGreaterThan(-1);
  const end = SRC.indexOf('\n  };\n', start);
  const endMut = SRC.indexOf('\n  });\n', start);
  const stops = [end, endMut].filter((n) => n > start);
  expect(stops.length).toBeGreaterThan(0);
  return SRC.slice(start, Math.min(...stops));
}

describe('Q180 Active switch on Edit Student', () => {
  it('Edit Student has an isActive FormField with the Active switch bound to the field (red if the Active switch is removed from Edit Student)', () => {
    const edit = dialogBlock('Edit Student Dialog');
    const at = edit.indexOf('data-testid="edit-switch-student-active"');
    expect(at).toBeGreaterThan(-1);
    const fieldStart = edit.lastIndexOf('<FormField', at);
    const field = edit.slice(fieldStart, edit.indexOf('/>', at));
    expect(field).toMatch(/name="isActive"/);
    expect(field).toMatch(/control=\{editStudentForm\.control\}/);
    const sw = field.slice(field.lastIndexOf('<Switch'));
    expect(sw).toMatch(/checked=\{field\.value\}/);
    expect(sw).toMatch(/onCheckedChange=\{field\.onChange\}/);
  });

  it('Add Student has no Active switch (red if the switch is added to Add)', () => {
    const add = dialogBlock('Add Student Dialog');
    expect(add).not.toContain('edit-switch-student-active');
    expect(add).not.toMatch(/name="isActive"/);
    expect(add).not.toMatch(/<Switch\b/);
  });

  it('handleEditStudent maps a NULL isActive to active (red if NULL isActive is passed through)', () => {
    const fn = declBlock('handleEditStudent');
    expect(fn).toMatch(/isActive:\s*student\.isActive\s*!==\s*false/);
    expect(fn).not.toMatch(/isActive:\s*student\.isActive\s*,/);
  });
});

describe('Q180 Delete offers Mark inactive instead', () => {
  it('Delete opens a dialog with Mark inactive instead and Delete permanently, no window.confirm (red if the confirm comes back)', () => {
    const fn = declBlock('handleDeleteStudent');
    expect(fn).not.toMatch(/window\.confirm/);
    expect(fn).toMatch(/setStudentToDelete\(student\)/);
    const dlg = dialogBlock('Delete Student Dialog');
    expect(dlg).toContain('data-testid="dialog-delete-student"');
    expect(dlg).toContain('data-testid="button-mark-inactive-instead"');
    expect(dlg).toContain('data-testid="button-delete-student-permanently"');
    expect(dlg).toMatch(/markStudentInactiveMutation\.mutate\(/);
    expect(dlg).toMatch(/deleteStudentMutation\.mutate\(/);
    expect(dlg).toMatch(/permanently\?/);
  });

  it('Mark inactive sends PUT /api/students/:id with only isActive: false (red if Mark inactive sends a DELETE or another body)', () => {
    const mut = declBlock('markStudentInactiveMutation');
    expect(mut).toMatch(
      /apiRequest\(`\/api\/students\/\$\{student\.id\}`,\s*"PUT",\s*\{\s*isActive:\s*false\s*\}\)/,
    );
    expect(mut).not.toMatch(/"DELETE"/);
    expect(mut).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\["\/api\/students"\]\s*\}\)/);
  });

  it('the edit mutation logs no student data (red if the logs come back)', () => {
    const mut = declBlock('editStudentMutation');
    expect(mut).not.toMatch(/console\.log\(/);
  });
});
