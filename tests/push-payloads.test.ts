// T4b: push payload builders and pushToRecipients (server/pushEvents.ts).
// Unit tests, no DB: storage and pushService are mocked. Covers lock-screen
// privacy (first names only, never a last name, address or email; each parent
// sees only their own children), the data.type strings the app routes on
// (imported from client/src/lib/pushRoutes.ts), and the send shape (fence
// awaited, one sendToUsers per distinct payload, never to a fenced-out id).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  filterPushRecipients: vi.fn(async (ids: string[]) => ids),
  sendToUsers: vi.fn(async () => undefined),
}));
vi.mock('../server/storage', () => ({ storage: { filterPushRecipients: m.filterPushRecipients } }));
vi.mock('../server/pushService', () => ({ pushService: { sendToUsers: m.sendToUsers } }));

import {
  joinFirstNames,
  targetsPerParent,
  stopArrivalPayload,
  schoolArrivalPayload,
  schoolDeparturePayload,
  boardedPayload,
  droppedOffPayload,
  messagePayload,
  alertPayload,
  pushToRecipients,
} from '../server/pushEvents';
import { PUSH_TYPES } from '../client/src/lib/pushRoutes';

beforeEach(() => {
  m.filterPushRecipients.mockReset().mockImplementation(async (ids: string[]) => ids);
  m.sendToUsers.mockReset().mockResolvedValue(undefined);
});

describe('joinFirstNames', () => {
  it('formats one, two and many names', () => {
    expect(joinFirstNames(['Ava'])).toBe('Ava');
    expect(joinFirstNames(['Ava', 'Leo'])).toBe('Ava and Leo');
    expect(joinFirstNames(['Ava', 'Leo', 'Mia'])).toBe('Ava, Leo and 1 more');
    expect(joinFirstNames(['Ava', 'Leo', 'Mia', 'Noa'])).toBe('Ava, Leo and 2 more');
    expect(joinFirstNames(['Ava', 'Ava'])).toBe('Ava');
  });
});

describe('payload privacy', () => {
  it('each parent gets a payload naming only their own children (never another family\'s child)', () => {
    const targets = targetsPerParent(
      [
        { parentId: 'p1', firstName: 'Ava' },
        { parentId: 'p2', firstName: 'Zed' },
        { parentId: 'p1', firstName: 'Leo' },
      ],
      (names) => stopArrivalPayload('Maple & 5th', names, 'stop-1'),
    );
    const byUser = Object.fromEntries(targets.map((t) => [t.userId, t.payload.body]));
    expect(byUser.p1).toBe('The bus is at Maple & 5th for Ava and Leo.');
    expect(byUser.p2).toBe('The bus is at Maple & 5th for Zed.');
    expect(byUser.p1).not.toContain('Zed');
    expect(byUser.p2).not.toContain('Ava');
  });

  it('E1 uses the stop NAME (or "your stop"), never an address', () => {
    expect(stopArrivalPayload('Maple & 5th', 'Ava', 's1').body).toBe('The bus is at Maple & 5th for Ava.');
    expect(stopArrivalPayload('', 'Ava', 's1').body).toBe('The bus is at your stop for Ava.');
    expect(stopArrivalPayload(null, 'Ava', 's1').body).toBe('The bus is at your stop for Ava.');
  });

  it('no payload carries an email, a last name or anything but type (+ senderId) in data', () => {
    const all = [
      stopArrivalPayload('Stop', 'Ava', 's1'),
      schoolArrivalPayload('School', 'Ava', 'sch1'),
      schoolDeparturePayload('School', 'Ava', 'v1'),
      boardedPayload('Ava', 'st1'),
      droppedOffPayload('Ava', 'st1'),
      alertPayload('Snow day', 'No buses', 'emergency'),
    ];
    for (const p of all) {
      expect(JSON.stringify(p)).not.toMatch(/@/);
      expect(Object.keys(p.data ?? {})).toEqual(['type']);
    }
    const msg = messagePayload('Ann S.', 'sender-1');
    expect(msg.data).toEqual({ type: 'message', senderId: 'sender-1' });
    expect(msg.body).toBe('Ann S. sent you a message');
  });
});

describe('data.type strings match the app routes', () => {
  it('every builder\'s data.type is one of PUSH_TYPES from client/src/lib/pushRoutes.ts (red if a builder uses e.g. bus_at_stop)', () => {
    const types = [
      stopArrivalPayload('S', 'A', 's').data?.type,
      schoolArrivalPayload('S', 'A', 's').data?.type,
      schoolDeparturePayload('S', 'A', 'v').data?.type,
      boardedPayload('A', 'st').data?.type,
      droppedOffPayload('A', 'st').data?.type,
      messagePayload('A', 'x').data?.type,
      alertPayload('t', 'm', 'delay').data?.type,
    ];
    expect(types).toEqual(['stop_arrival', 'school_arrival', 'school_departure', 'boarded', 'dropped_off', 'message', 'alert']);
    for (const t of types) expect(PUSH_TYPES as readonly string[]).toContain(t);
  });

  it('alert data is exactly { type: "alert" } whatever the admin type; the admin type only picks the category', () => {
    for (const t of ['emergency', 'delay', 'info', 'route_change']) {
      expect(alertPayload('T', 'M', t).data).toEqual({ type: 'alert' });
    }
    expect(alertPayload('T', 'M', 'emergency').category).toBe('EMERGENCY');
    expect(alertPayload('T', 'M', 'delay').category).toBe('DELAY');
    expect(alertPayload('T', 'M', 'info').category).toBe('ALERT');
  });

  it('E1-E5 carry the collapse id, a 900 s expiry and the bus_updates channel', () => {
    const cases: Array<[ReturnType<typeof stopArrivalPayload>, string]> = [
      [stopArrivalPayload('S', 'A', 'rs1'), 'stop-rs1'],
      [schoolArrivalPayload('S', 'A', 'sch1'), 'school-arr-sch1'],
      [schoolDeparturePayload('S', 'A', 'v1'), 'school-dep-v1'],
      [boardedPayload('A', 'st1'), 'board-st1'],
      [droppedOffPayload('A', 'st1'), 'drop-st1'],
    ];
    for (const [p, collapse] of cases) {
      expect(p.collapseId).toBe(collapse);
      expect(p.expiresInSec).toBe(900);
      expect(p.channelId).toBe('bus_updates');
    }
  });
});

describe('pushToRecipients', () => {
  it('fences all ids once with the companyId, then calls sendToUsers once per distinct payload with only the kept ids', async () => {
    m.filterPushRecipients.mockResolvedValue(['p1', 'p3']);
    const a = boardedPayload('Ava', 'st1');
    const b = boardedPayload('Zed', 'st2');
    await pushToRecipients('boarded', 'co-a', [
      { userId: 'p1', payload: a },
      { userId: 'p2', payload: a },
      { userId: 'p3', payload: b },
    ]);
    expect(m.filterPushRecipients).toHaveBeenCalledTimes(1);
    expect(m.filterPushRecipients.mock.calls[0][1]).toBe('co-a');
    expect([...(m.filterPushRecipients.mock.calls[0][0] as string[])].sort()).toEqual(['p1', 'p2', 'p3']);
    expect(m.sendToUsers).toHaveBeenCalledTimes(2);
    const sent = m.sendToUsers.mock.calls.map((c) => [(c[0] as string[]).join(','), (c[1] as { body: string }).body]);
    expect(sent).toEqual(expect.arrayContaining([['p1', 'Ava is on the bus.'], ['p3', 'Zed is on the bus.']]));
  });

  it('sends nothing when the fence keeps nobody', async () => {
    m.filterPushRecipients.mockResolvedValue([]);
    await pushToRecipients('stop_arrival', 'co-a', [{ userId: 'p1', payload: stopArrivalPayload('S', 'Ava', 's1') }]);
    expect(m.sendToUsers).not.toHaveBeenCalled();
  });

  it('does not wait for delivery and never throws when the send fails', async () => {
    m.sendToUsers.mockImplementation(() => new Promise((_r, reject) => setTimeout(() => reject(new Error('apns down')), 50)));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(pushToRecipients('boarded', 'co-a', [{ userId: 'p1', payload: boardedPayload('Ava', 'st1') }])).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 80));
    expect(err.mock.calls.map((c) => c.join(' ')).join('\n')).not.toContain('p1');
    err.mockRestore();
  });
});
