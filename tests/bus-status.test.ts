import { describe, it, expect } from 'vitest';
import {
  busStatusEnum,
  notificationTypeEnum,
  checkInStatusEnum,
  journeyEventTypeEnum,
} from '@shared/schema';

// The real Postgres enums from the schema (WT-5): these tests go red if the
// schema's values change. There is no server rule for bus-status transitions
// in v1 (DeShaun, 2026-11-13): a PATCH may set any valid status, so nothing
// here tests transitions.
const VALID_BUS_STATUSES = busStatusEnum.enumValues;
const VALID_NOTIFICATION_TYPES = notificationTypeEnum.enumValues;
const VALID_CHECKIN_STATUSES = checkInStatusEnum.enumValues;
const VALID_JOURNEY_EVENTS = journeyEventTypeEnum.enumValues;

describe('Bus Status Management', () => {
  it('should have exactly 5 valid bus statuses', () => {
    expect(VALID_BUS_STATUSES).toHaveLength(5);
  });

  it('should include idle as a valid status', () => {
    expect(VALID_BUS_STATUSES).toContain('idle');
  });

  it('should include on_route as a valid status', () => {
    expect(VALID_BUS_STATUSES).toContain('on_route');
  });

  it('should include maintenance as a valid status', () => {
    expect(VALID_BUS_STATUSES).toContain('maintenance');
  });

  it('should include emergency as a valid status', () => {
    expect(VALID_BUS_STATUSES).toContain('emergency');
  });

  it('should include inactive as a valid status', () => {
    expect(VALID_BUS_STATUSES).toContain('inactive');
  });
});

describe('Notification Types', () => {
  it('should have exactly 4 notification types', () => {
    expect(VALID_NOTIFICATION_TYPES).toHaveLength(4);
  });

  it('should include delay notification', () => {
    expect(VALID_NOTIFICATION_TYPES).toContain('delay');
  });

  it('should include emergency notification', () => {
    expect(VALID_NOTIFICATION_TYPES).toContain('emergency');
  });

  it('should include info notification', () => {
    expect(VALID_NOTIFICATION_TYPES).toContain('info');
  });

  it('should include route_change notification', () => {
    expect(VALID_NOTIFICATION_TYPES).toContain('route_change');
  });
});

describe('Student Check-In Statuses', () => {
  it('should have exactly 3 check-in statuses', () => {
    expect(VALID_CHECKIN_STATUSES).toHaveLength(3);
  });

  it('should list the statuses in check-in order', () => {
    expect(VALID_CHECKIN_STATUSES[0]).toBe('waiting');
    expect(VALID_CHECKIN_STATUSES[1]).toBe('boarded');
    expect(VALID_CHECKIN_STATUSES[2]).toBe('dropped_off');
  });
});

describe('Journey Event Tracking', () => {
  it('should have exactly 4 journey event types', () => {
    expect(VALID_JOURNEY_EVENTS).toHaveLength(4);
  });

  it('journey should start with depart_homebase', () => {
    expect(VALID_JOURNEY_EVENTS[0]).toBe('depart_homebase');
  });

  it('journey should end with arrive_homebase', () => {
    expect(VALID_JOURNEY_EVENTS[VALID_JOURNEY_EVENTS.length - 1]).toBe('arrive_homebase');
  });

  it('should follow correct journey sequence', () => {
    expect(VALID_JOURNEY_EVENTS).toEqual([
      'depart_homebase',
      'arrive_school',
      'depart_school',
      'arrive_homebase',
    ]);
  });
});
