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

  it('Q195: the mark-inactive toast names the full student (red if it goes back to the first name only)', () => {
    const mut = declBlock('markStudentInactiveMutation');
    const onSuccess = mut.slice(mut.indexOf('onSuccess:'), mut.indexOf('onError:'));
    expect(onSuccess).toMatch(/title:\s*"Marked inactive"/);
    expect(onSuccess).toMatch(/description:\s*`\$\{student\.firstName\} \$\{student\.lastName\} is now inactive`/);
  });

  it('the edit mutation logs no student data (red if the logs come back)', () => {
    const mut = declBlock('editStudentMutation');
    expect(mut).not.toMatch(/console\.log\(/);
  });
});

describe('Q180 r2 true Delete wording; NULL counts as active in the list', () => {
  it('the Delete dialog says students with records cannot be deleted (red if the delete text promises history is removed again)', () => {
    const dlg = dialogBlock('Delete Student Dialog');
    expect(dlg).toContain("can't be deleted; mark them inactive instead");
    expect(dlg).not.toContain('history goes too');
  });

  it('the student Status badge treats NULL isActive as active (red if the list treats NULL isActive as inactive)', () => {
    const at = SRC.indexOf('data-testid={`badge-student-status-${student.id}`}');
    expect(at, 'no student status badge test id').toBeGreaterThan(-1);
    const start = SRC.lastIndexOf('<Badge', at);
    const badge = SRC.slice(start, SRC.indexOf('</Badge>', at));
    expect(badge).toMatch(/variant=\{student\.isActive !== false \?/);
    expect(badge).toMatch(/\{student\.isActive !== false \? "Active" : "Inactive"\}/);
    expect(badge).not.toMatch(/student\.isActive \?/);
  });

  it('the Active Students count treats NULL isActive as active (red if the count treats NULL isActive as inactive)', () => {
    const at = SRC.indexOf('>Active Students</CardTitle>');
    expect(at, 'no Active Students card').toBeGreaterThan(-1);
    const card = SRC.slice(at, SRC.indexOf('</Card>', at));
    expect(card).toMatch(/students\.filter\(\(s: any\) => s\.isActive !== false\)\.length/);
  });
});
