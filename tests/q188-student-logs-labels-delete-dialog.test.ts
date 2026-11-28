import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Q188: no student data in the browser console, labelled row buttons, and a
// Delete dialog that waits for the DELETE to answer. No React test harness
// (no jsdom), so this scans the page source; every match is anchored to a
// declaration, a dialog block or a test id, never the whole file.
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

// `const <name> = …` up to its top-level close (`\n  });\n` or `\n  };\n`).
function declBlock(name: string): string {
  const start = SRC.indexOf(`const ${name} = `);
  expect(start, `no const ${name}`).toBeGreaterThan(-1);
  const stops = [SRC.indexOf('\n  };\n', start), SRC.indexOf('\n  });\n', start)].filter((n) => n > start);
  expect(stops.length).toBeGreaterThan(0);
  return SRC.slice(start, Math.min(...stops));
}

// The opening tag text from the `<` before `marker` up to the end of the marker.
function openTagTo(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `no ${marker}`).toBeGreaterThan(-1);
  return src.slice(src.lastIndexOf('<', at), at + marker.length);
}

// Every console.error( call in `block` prints a fixed string literal only.
function expectFixedErrorLogs(block: string, label: string) {
  const calls = block.match(/console\.error\([^)]*\)/g) ?? [];
  expect(calls.length, `${label}: no console.error`).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call, `${label}: ${call}`).toMatch(/^console\.error\(\s*"[^"]*"\s*\)$/);
  }
}

describe('Q188 (a) no student data in the browser console', () => {
  it('create, Add form, edit and delete log no student data (red if a student-data log comes back)', () => {
    const create = declBlock('createStudentMutation');
    expect(create).not.toMatch(/console\.log\(/);
    expectFixedErrorLogs(create, 'createStudentMutation');

    expect(dialogBlock('Add Student Dialog')).not.toMatch(/console\.log\(/);

    expectFixedErrorLogs(declBlock('editStudentMutation'), 'editStudentMutation');
    expectFixedErrorLogs(declBlock('deleteStudentMutation'), 'deleteStudentMutation');
  });
});

describe('Q188 (b) labelled row buttons', () => {
  it('Edit and Delete on the student row have aria-label and title (red if an icon button loses its label)', () => {
    const edit = openTagTo(SRC, 'data-testid={`button-edit-student-${student.id}`}');
    expect(edit).toMatch(/^<Button\s/);
    expect(edit).toMatch(/aria-label="Edit student"/);
    expect(edit).toMatch(/title="Edit student"/);

    const del = openTagTo(SRC, 'data-testid={`button-delete-student-${student.id}`}');
    expect(del).toMatch(/^<Button\s/);
    expect(del).toMatch(/aria-label="Delete student"/);
    expect(del).toMatch(/title="Delete student"/);
  });
});

describe('Q188 (c) the Delete dialog waits for the answer', () => {
  it('Delete permanently is a plain Button that does not close the dialog; onSuccess closes it; no closing while pending (red if the dialog closes before the DELETE answers)', () => {
    const dlg = dialogBlock('Delete Student Dialog');
    expect(dlg).not.toMatch(/<AlertDialogAction\b/);

    const btn = openTagTo(dlg, 'data-testid="button-delete-student-permanently"');
    expect(btn).toMatch(/^<Button\s/);
    expect(btn).toMatch(/deleteStudentMutation\.mutate\(/);
    expect(btn).not.toMatch(/setStudentToDelete\(null\)/);
    expect(dlg).toMatch(/deleteStudentMutation\.isPending \? "Deleting\.\.\." : "Delete permanently"/);

    const del = declBlock('deleteStudentMutation');
    const onSuccess = del.slice(del.indexOf('onSuccess:'), del.indexOf('onError:'));
    expect(onSuccess).toMatch(/setStudentToDelete\(null\)/);

    const root = dlg.slice(dlg.indexOf('<AlertDialog open='), dlg.indexOf('<AlertDialogContent'));
    expect(root).toMatch(/onOpenChange=/);
    expect(root).toMatch(/!deleteStudentMutation\.isPending/);
    expect(root).toMatch(/!markStudentInactiveMutation\.isPending/);
  });

  // Q191: pins SHELL's Q188 gaps.
  it('delete onError has no setStudentToDelete( (red if a refused delete closes the dialog)', () => {
    const del = declBlock('deleteStudentMutation');
    expect(del.indexOf('onError:'), 'no onError').toBeGreaterThan(-1);
    const onError = del.slice(del.indexOf('onError:'));
    expect(onError).toMatch(/toast\(/);
    expect(onError).not.toMatch(/setStudentToDelete\(/);
  });

  it('Cancel, Mark inactive and Delete permanently are each disabled while either mutation is pending (red if a button loses an isPending name in disabled)', () => {
    const dlg = dialogBlock('Delete Student Dialog');
    for (const id of [
      'button-cancel-delete-student',
      'button-mark-inactive-instead',
      'button-delete-student-permanently',
    ]) {
      const tag = openTagTo(dlg, `data-testid="${id}"`);
      expect(tag, id).toMatch(/^<Button\s/);
      const disabled = tag.match(/disabled=\{([^}]*)\}/);
      expect(disabled, `${id}: no disabled`).not.toBeNull();
      expect(disabled![1], id).toMatch(/deleteStudentMutation\.isPending/);
      expect(disabled![1], id).toMatch(/markStudentInactiveMutation\.isPending/);
    }
  });
});
