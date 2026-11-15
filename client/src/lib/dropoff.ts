// T2b: the driver's per-student "Off the bus" button (E5, POST /api/driver/student-dropoff).
// Pure: it imports only lib/errorText (itself dependency-free), so a Node unit
// test can import this file.
import { friendlyErrorText } from "./errorText";

export type DropoffState = "hidden" | "can_drop" | "dropped";

type AttendanceRow = { status?: string | null; droppedOffAt?: string | Date | null } | null | undefined;

/**
 * Which drop-off control a student card shows for today's attendance row:
 * - 'hidden': no mark today, or marked anything but present;
 * - 'can_drop': present and not yet off the bus (show the button);
 * - 'dropped': present and off the bus (show the time, lock Present/Absent).
 */
export function dropoffState(row: AttendanceRow): DropoffState {
  if (!row || row.status !== "present") return "hidden";
  return row.droppedOffAt ? "dropped" : "can_drop";
}

/** Toast text for an error thrown by apiRequest (`"<status>: <body>"`) on the drop-off POST. */
export function dropoffErrorText(err: unknown): string {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const match = /^(\d{3}): /.exec(text);
  if (match) {
    const status = Number(match[1]);
    // The server's 409: no mark today by this driver, or marked absent.
    if (status === 409) return "Mark them present first.";
    if (status === 404) return "This student isn't on your route.";
  }
  return friendlyErrorText(err, "Couldn't mark them off the bus. Please try again.");
}
