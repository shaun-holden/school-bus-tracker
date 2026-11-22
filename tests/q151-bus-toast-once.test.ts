import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Q151: the driver dashboard's "Bus Assignment Updated" toast fired every
// ~30 s while on duty, because its effect depended on the whole assignedBus
// object (new on every /api/buses refetch) and a never-cleared sessionStorage
// flag. The suite has no DOM setup, so these are source scans of the guards.

const SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'client/src/pages/driver-dashboard.tsx'),
  'utf8',
);

// The useEffect block that contains the toast title, through its `}, [deps]);`.
function toastEffect(): { body: string; deps: string } {
  const at = SRC.indexOf('"Bus Assignment Updated"');
  expect(at, 'toast title present').toBeGreaterThan(-1);
  const start = SRC.lastIndexOf('useEffect(', at);
  expect(start, 'useEffect before the toast').toBeGreaterThan(-1);
  const end = SRC.slice(at).match(/\}, \[([^\]]*)\]\);/);
  expect(end, 'dependency array after the toast').not.toBeNull();
  return { body: SRC.slice(start, at + end!.index! + end![0].length), deps: end![1] };
}

describe('Q151: "Bus Assignment Updated" shows only when the bus id changes', () => {
  it("(a) no 'initial-bus-load-shown' flag and no sessionStorage in driver-dashboard (red if the never-cleared flag comes back)", () => {
    expect(SRC).not.toContain('initial-bus-load-shown');
    expect(SRC).not.toContain('sessionStorage');
  });

  it('(b) the toast effect deps hold the bus id, not the bare assignedBus object (red if deps go back to [assignedBus, toast])', () => {
    const deps = toastEffect().deps.split(',').map((d) => d.trim());
    expect(deps).not.toContain('assignedBus');
    expect(deps.includes('assignedBusId') || deps.includes('assignedBus?.id')).toBe(true);
  });

  it('(c) the toast is guarded by a useRef id comparison (lastBusIdRef)', () => {
    expect(SRC).toMatch(/const lastBusIdRef = useRef</);
    expect(toastEffect().body).toMatch(/assignedBusId !== lastBusIdRef\.current/);
  });

  it('(d) no console.log of assignedBus in the toast effect (red if the bus row with live GPS is logged again)', () => {
    expect(toastEffect().body).not.toMatch(/console\.log\([^)]*assignedBus/);
  });
});
