import { storage } from './storage';
import { pushService, type PushPayload } from './pushService';

export interface PushTarget { userId: string; payload: PushPayload }

/** Fence all ids once (awaited), then send fire-and-forget, one sendToUsers per distinct payload. */
export async function pushToRecipients(
  event: string,
  companyId: string | null | undefined,
  targets: PushTarget[],
): Promise<void> {
  const ids = Array.from(new Set(targets.map(t => t.userId)));
  const kept = new Set(await storage.filterPushRecipients(ids, companyId));
  // Counts only: never ids, names or tokens.
  console.log("Push event", { event, companyId, kept: kept.size, dropped: ids.length - kept.size });
  if (kept.size === 0) return;

  const groups = new Map<string, { payload: PushPayload; userIds: Set<string> }>();
  for (const t of targets) {
    if (!kept.has(t.userId)) continue;
    const key = JSON.stringify(t.payload);
    let g = groups.get(key);
    if (!g) {
      g = { payload: t.payload, userIds: new Set() };
      groups.set(key, g);
    }
    g.userIds.add(t.userId);
  }

  for (const g of Array.from(groups.values())) {
    // Fire-and-forget: not awaited.
    pushService.sendToUsers(Array.from(g.userIds), g.payload).catch(() => console.error("Push send failed", { event }));
  }
}

/** "Ava", "Ava and Leo", "Ava, Leo and 1 more". Duplicates removed, order kept. */
export function joinFirstNames(names: string[]): string {
  const unique = Array.from(new Set(names));
  if (unique.length <= 1) return unique[0] ?? '';
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique[0]}, ${unique[1]} and ${unique.length - 2} more`;
}

/** One target per parent, built from that parent's own children's first names. */
export function targetsPerParent(
  rows: Array<{ parentId: string; firstName: string }>,
  build: (names: string) => PushPayload,
): PushTarget[] {
  const byParent = new Map<string, string[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentId);
    if (list) list.push(r.firstName);
    else byParent.set(r.parentId, [r.firstName]);
  }
  return Array.from(byParent.entries()).map(([userId, names]) => ({
    userId,
    payload: build(joinFirstNames(names)),
  }));
}

// Bus events (E1-E5): short-lived, bus_updates channel, data carries only type.
const busEventBase = { expiresInSec: 900, channelId: 'bus_updates' as const, sound: 'default' };

export function stopArrivalPayload(stopName: string | null | undefined, names: string, routeStopId: string): PushPayload {
  return {
    ...busEventBase,
    title: 'Bus arrived',
    body: `The bus is at ${stopName?.trim() || 'your stop'} for ${names}.`,
    data: { type: 'stop_arrival' },
    collapseId: `stop-${routeStopId}`,
  };
}

export function schoolArrivalPayload(schoolName: string | null | undefined, names: string, schoolId: string): PushPayload {
  return {
    ...busEventBase,
    title: 'Bus arrived at school',
    body: `${names}'s bus has arrived at ${schoolName || 'school'}.`,
    data: { type: 'school_arrival' },
    collapseId: `school-arr-${schoolId}`,
  };
}

export function schoolDeparturePayload(schoolName: string | null | undefined, names: string, visitId: string): PushPayload {
  return {
    ...busEventBase,
    title: 'Bus on the way',
    body: `${names}'s bus has left ${schoolName || 'school'}.`,
    data: { type: 'school_departure' },
    collapseId: `school-dep-${visitId}`,
  };
}

export function boardedPayload(names: string, studentId: string): PushPayload {
  return {
    ...busEventBase,
    title: 'On the bus',
    body: `${names} is on the bus.`,
    data: { type: 'boarded' },
    collapseId: `board-${studentId}`,
  };
}

export function droppedOffPayload(names: string, studentId: string): PushPayload {
  return {
    ...busEventBase,
    title: 'Dropped off',
    body: `${names} has been dropped off.`,
    data: { type: 'dropped_off' },
    collapseId: `drop-${studentId}`,
  };
}

/** Never the message text. */
export function messagePayload(senderName: string, senderId: string): PushPayload {
  return {
    title: 'New message',
    body: `${senderName} sent you a message`,
    category: 'MESSAGE',
    channelId: 'messages',
    data: { type: 'message', senderId },
  };
}

/** Same shape as pushService's alert payload; data is exactly { type: 'alert' }. */
export function alertPayload(title: string, message: string, adminType: string): PushPayload {
  let category = 'ALERT';
  if (adminType === 'emergency') category = 'EMERGENCY';
  if (adminType === 'delay') category = 'DELAY';
  return { title, body: message, sound: 'default', category, channelId: 'bus_updates', data: { type: 'alert' } };
}
