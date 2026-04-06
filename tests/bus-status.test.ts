import { describe, it, expect } from 'vitest';

// Bus status values from the schema
const VALID_BUS_STATUSES = ['idle', 'on_route', 'maintenance', 'emergency', 'inactive'] as const;
type BusStatus = typeof VALID_BUS_STATUSES[number];

// Notification types from the schema
const VALID_NOTIFICATION_TYPES = ['delay', 'emergency', 'info', 'route_change'] as const;
type NotificationType = typeof VALID_NOTIFICATION_TYPES[number];

// Check-in statuses from the schema
const VALID_CHECKIN_STATUSES = ['waiting', 'boarded', 'dropped_off'] as const;
type CheckInStatus = typeof VALID_CHECKIN_STATUSES[number];

// Journey event types
const VALID_JOURNEY_EVENTS = ['depart_homebase', 'arrive_school', 'depart_school', 'arrive_homebase'] as const;
type JourneyEvent = typeof VALID_JOURNEY_EVENTS[number];

// Vehicle issue priorities
const VALID_PRIORITIES = ['normal', 'high', 'urgent'] as const;
type Priority = typeof VALID_PRIORITIES[number];

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

describe('Bus Status Transitions', () => {
  function isValidTransition(from: BusStatus, to: BusStatus): boolean {
    // Business rules for valid status transitions
    const transitions: Record<BusStatus, BusStatus[]> = {
      idle: ['on_route', 'maintenance', 'emergency', 'inactive'],
      on_route: ['idle', 'emergency', 'maintenance'],
      maintenance: ['idle', 'inactive'],
      emergency: ['idle', 'maintenance'],
      inactive: ['idle', 'maintenance'],
    };
    return transitions[from].includes(to);
  }

  it('should allow idle bus to go on route', () => {
    expect(isValidTransition('idle', 'on_route')).toBe(true);
  });

  it('should allow on-route bus to return to idle', () => {
    expect(isValidTransition('on_route', 'idle')).toBe(true);
  });

  it('should allow emergency from on_route', () => {
    expect(isValidTransition('on_route', 'emergency')).toBe(true);
  });

  it('should allow emergency bus to return to idle', () => {
    expect(isValidTransition('emergency', 'idle')).toBe(true);
  });

  it('should not allow on_route bus to go directly to inactive', () => {
    expect(isValidTransition('on_route', 'inactive')).toBe(false);
  });

  it('should allow idle bus to go to maintenance', () => {
    expect(isValidTransition('idle', 'maintenance')).toBe(true);
  });

  it('should allow inactive bus to return to idle', () => {
    expect(isValidTransition('inactive', 'idle')).toBe(true);
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

describe('Student Check-In Flow', () => {
  it('should have exactly 3 check-in statuses', () => {
    expect(VALID_CHECKIN_STATUSES).toHaveLength(3);
  });

  it('should follow correct check-in sequence', () => {
    expect(VALID_CHECKIN_STATUSES[0]).toBe('waiting');
    expect(VALID_CHECKIN_STATUSES[1]).toBe('boarded');
    expect(VALID_CHECKIN_STATUSES[2]).toBe('dropped_off');
  });

  function getNextStatus(current: CheckInStatus): CheckInStatus | null {
    const flow: Record<CheckInStatus, CheckInStatus | null> = {
      waiting: 'boarded',
      boarded: 'dropped_off',
      dropped_off: null,
    };
    return flow[current];
  }

  it('waiting students should transition to boarded', () => {
    expect(getNextStatus('waiting')).toBe('boarded');
  });

  it('boarded students should transition to dropped_off', () => {
    expect(getNextStatus('boarded')).toBe('dropped_off');
  });

  it('dropped_off should be final state', () => {
    expect(getNextStatus('dropped_off')).toBeNull();
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

describe('Vehicle Issue Priority', () => {
  it('should have exactly 3 priority levels', () => {
    expect(VALID_PRIORITIES).toHaveLength(3);
  });

  function getPriorityWeight(priority: Priority): number {
    const weights: Record<Priority, number> = {
      normal: 1,
      high: 2,
      urgent: 3,
    };
    return weights[priority];
  }

  it('urgent should have highest priority weight', () => {
    expect(getPriorityWeight('urgent')).toBeGreaterThan(getPriorityWeight('high'));
    expect(getPriorityWeight('urgent')).toBeGreaterThan(getPriorityWeight('normal'));
  });

  it('high should be between normal and urgent', () => {
    expect(getPriorityWeight('high')).toBeGreaterThan(getPriorityWeight('normal'));
    expect(getPriorityWeight('high')).toBeLessThan(getPriorityWeight('urgent'));
  });

  it('normal should have lowest priority weight', () => {
    expect(getPriorityWeight('normal')).toBe(1);
  });
});
