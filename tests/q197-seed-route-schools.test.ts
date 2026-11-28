// Q197: the staging seed links each seeded route to its school in
// route_schools (the admin Add/Edit student check reads only that table), and
// a re-run never duplicates the row. Source scan only: never import
// scripts/seed-staging.ts, which runs seed() at the top level and would try to
// reach a database.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(resolve(__dirname, '../scripts/seed-staging.ts'), 'utf8');
const LOOP_START = 'for (const r of [1, 2])';
const LOOP_END = "// Drivers' assigned routes.";

function routeLoop(): string {
  const start = SRC.indexOf(LOOP_START);
  const end = SRC.indexOf(LOOP_END, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

// The tx.insert(routeSchools) statement inside the route loop, up to its ';'.
function routeSchoolsInsert(): string | undefined {
  const loop = routeLoop();
  const at = loop.indexOf('tx.insert(routeSchools)');
  if (at < 0) return undefined;
  return loop.slice(at, loop.indexOf(';', at) + 1);
}

describe('Q197 staging seed route_schools rows', () => {
  it('imports routeSchools from the shared schema module (red if the import is dropped)', () => {
    const imp = SRC.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/shared\/schema'/);
    expect(imp).not.toBeNull();
    expect(imp![1].split(',').map((s) => s.trim())).toContain('routeSchools');
  });

  it('the route loop inserts a route_schools row for route.id + school.id (red if the row is dropped or moved out of the route loop)', () => {
    const stmt = routeSchoolsInsert();
    expect(stmt).toBeDefined();
    expect(stmt).toMatch(/routeId:\s*route\.id/);
    expect(stmt).toMatch(/schoolId:\s*school\.id/);
  });

  it('the route_schools insert has .onConflictDoNothing() (red if the conflict guard is dropped: a re-run would fail on unique(route_id, school_id))', () => {
    const stmt = routeSchoolsInsert();
    expect(stmt).toBeDefined();
    expect(stmt).toContain('.onConflictDoNothing()');
  });
});
