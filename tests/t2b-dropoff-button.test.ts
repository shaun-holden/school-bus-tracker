// T2b: the driver's per-student "Off the bus" button. Unit only (no DB, no DOM):
// the pure helpers in client/src/lib/dropoff.ts, plus source checks on the
// driver dashboard's student card and its drop-off mutation.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dropoffState, dropoffErrorText } from "../client/src/lib/dropoff";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const AT = "2026-11-14T15:30:00.000Z";

describe("dropoffState", () => {
  it.each([
    ["no row", null, "hidden"],
    ["undefined row", undefined, "hidden"],
    ["absent", { status: "absent", droppedOffAt: null }, "hidden"],
    ["absent + droppedOffAt (marked absent after a drop-off)", { status: "absent", droppedOffAt: AT }, "hidden"],
    ["present", { status: "present", droppedOffAt: null }, "can_drop"],
    ["present, droppedOffAt missing", { status: "present" }, "can_drop"],
    ["present + droppedOffAt", { status: "present", droppedOffAt: AT }, "dropped"],
  ] as const)("%s → %s", (_label, row, expected) => {
    expect(dropoffState(row as never)).toBe(expected);
  });
});

describe("dropoffErrorText", () => {
  it("409 (not marked present today) → mark them present first", () => {
    expect(dropoffErrorText(new Error('409: {"message":"Student isn\'t marked present today"}'))).toBe("Mark them present first.");
  });
  it("404 → not on your route", () => {
    expect(dropoffErrorText(new Error('404: {"message":"Student not found"}'))).toBe("This student isn't on your route.");
  });
  it("a 409 with a non-JSON body still maps on the status", () => {
    expect(dropoffErrorText(new Error("409: Conflict"))).toBe("Mark them present first.");
  });
  it("an unknown status with an HTML body → the generic text", () => {
    expect(dropoffErrorText(new Error("502: <html>Bad gateway</html>"))).toBe("Couldn't mark them off the bus. Please try again.");
  });
  it("not an Error (no status) → the generic text", () => {
    expect(dropoffErrorText(undefined)).toBe("Couldn't mark them off the bus. Please try again.");
  });
});

describe("driver-dashboard.tsx wiring", () => {
  const src = read("client/src/pages/driver-dashboard.tsx");

  it("the drop-off mutation posts exactly { studentId } to /api/driver/student-dropoff", () => {
    expect(src).toMatch(/apiRequest\("\/api\/driver\/student-dropoff", "POST", \{ studentId \}\)/);
    expect(src.match(/\/api\/driver\/student-dropoff/g)).toHaveLength(1);
  });

  it("the Off the bus button renders only when dropoffState(...) === 'can_drop'", () => {
    const m = src.match(/\{dropState === "can_drop" && \(\s*<Button[\s\S]*?<\/Button>/);
    expect(m, "gated button").not.toBeNull();
    expect(m![0]).toContain('data-testid={`button-dropoff-${student.id}`}');
    expect(m![0]).toMatch(/disabled=\{[^}]*!isOnDuty/);
    expect(src).toMatch(/const dropState = dropoffState\(attendance\);/);
  });

  it("Present and Absent are disabled once the student is off the bus", () => {
    for (const id of ["button-mark-present-", "button-mark-absent-"]) {
      const i = src.indexOf(`data-testid={\`${id}`);
      expect(i, id).toBeGreaterThan(-1);
      const before = src.slice(src.lastIndexOf("<Button", i), i);
      expect(before, id).toMatch(/disabled=\{markAttendanceMutation\.isPending \|\| dropState === "dropped"\}/);
    }
  });

  it("the card's tap-to-mark-present ignores taps inside the action area (stopPropagation kept)", () => {
    const area = src.indexOf('onClick={(e) => e.stopPropagation()}');
    const button = src.indexOf('button-dropoff-');
    expect(area).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(area);
  });
});
