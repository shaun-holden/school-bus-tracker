import { describe, it, expect } from 'vitest';
import { insertParentNotificationSchema, insertDirectMessageSchema, insertLinkCodeSchema } from '@shared/schema';

describe('Parent Features - Absence Reporting', () => {
  function canReportAbsence(params: {
    userRole: string;
    parentStudents: { id: string }[];
    requestedStudentId: string;
  }): { allowed: boolean; reason?: string } {
    if (params.userRole !== 'parent') {
      return { allowed: false, reason: 'Unauthorized' };
    }
    const ownsStudent = params.parentStudents.some(s => s.id === params.requestedStudentId);
    if (!ownsStudent) {
      return { allowed: false, reason: 'Unauthorized - not your student' };
    }
    return { allowed: true };
  }

  it('should allow parent to report absence for own child', () => {
    const result = canReportAbsence({
      userRole: 'parent',
      parentStudents: [{ id: 'student-1' }, { id: 'student-2' }],
      requestedStudentId: 'student-1',
    });
    expect(result.allowed).toBe(true);
  });

  it('should reject non-parent users', () => {
    const result = canReportAbsence({
      userRole: 'driver',
      parentStudents: [{ id: 'student-1' }],
      requestedStudentId: 'student-1',
    });
    expect(result.allowed).toBe(false);
  });

  it('should reject reporting for another parents child', () => {
    const result = canReportAbsence({
      userRole: 'parent',
      parentStudents: [{ id: 'student-1' }],
      requestedStudentId: 'student-999',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not your student');
  });

  it('should reject admin trying to use parent absence endpoint', () => {
    const result = canReportAbsence({
      userRole: 'admin',
      parentStudents: [],
      requestedStudentId: 'student-1',
    });
    expect(result.allowed).toBe(false);
  });
});

describe('Parent Features - Check-In Access Control', () => {
  function canManageCheckIn(params: {
    userRole: string;
    linkedStudents: { id: string }[];
    requestedStudentId: string;
  }): { allowed: boolean; reason?: string } {
    if (params.userRole !== 'parent') {
      return { allowed: false, reason: 'Only parents can manage check-in' };
    }
    const hasAccess = params.linkedStudents.some(s => s.id === params.requestedStudentId);
    if (!hasAccess) {
      return { allowed: false, reason: "You don't have access to this student" };
    }
    return { allowed: true };
  }

  it('should allow parent to enable check-in for linked child', () => {
    const result = canManageCheckIn({
      userRole: 'parent',
      linkedStudents: [{ id: 'student-1' }],
      requestedStudentId: 'student-1',
    });
    expect(result.allowed).toBe(true);
  });

  it('should reject driver trying to manage check-in', () => {
    const result = canManageCheckIn({
      userRole: 'driver',
      linkedStudents: [],
      requestedStudentId: 'student-1',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('parents');
  });

  it('should reject parent for unlinked student', () => {
    const result = canManageCheckIn({
      userRole: 'parent',
      linkedStudents: [{ id: 'student-1' }],
      requestedStudentId: 'student-999',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("don't have access");
  });
});

describe('Parent Features - Check-In Enable/Disable Validation', () => {
  function validateCheckInRequest(data: { studentId?: string; deviceId?: string }): { valid: boolean; reason?: string } {
    if (!data.studentId || !data.deviceId) {
      return { valid: false, reason: 'Student ID and device ID are required' };
    }
    return { valid: true };
  }

  it('should accept valid check-in enable request', () => {
    const result = validateCheckInRequest({ studentId: 'student-1', deviceId: 'device-abc' });
    expect(result.valid).toBe(true);
  });

  it('should reject missing student ID', () => {
    const result = validateCheckInRequest({ deviceId: 'device-abc' });
    expect(result.valid).toBe(false);
  });

  it('should reject missing device ID', () => {
    const result = validateCheckInRequest({ studentId: 'student-1' });
    expect(result.valid).toBe(false);
  });

  it('should reject empty request', () => {
    const result = validateCheckInRequest({});
    expect(result.valid).toBe(false);
  });
});

describe('Parent Features - Children Deduplication', () => {
  function deduplicateChildren(
    directChildren: { id: string; firstName: string }[],
    linkedChildren: { id: string; firstName: string }[]
  ): { id: string; firstName: string }[] {
    const childrenMap = new Map();
    for (const child of directChildren) {
      childrenMap.set(child.id, child);
    }
    for (const child of linkedChildren) {
      childrenMap.set(child.id, child);
    }
    return Array.from(childrenMap.values());
  }

  it('should combine direct and linked children', () => {
    const direct = [{ id: 'child-1', firstName: 'Alice' }];
    const linked = [{ id: 'child-2', firstName: 'Bob' }];
    const result = deduplicateChildren(direct, linked);
    expect(result).toHaveLength(2);
  });

  it('should deduplicate overlapping children', () => {
    const direct = [{ id: 'child-1', firstName: 'Alice' }];
    const linked = [{ id: 'child-1', firstName: 'Alice' }];
    const result = deduplicateChildren(direct, linked);
    expect(result).toHaveLength(1);
  });

  it('should handle empty direct children', () => {
    const linked = [{ id: 'child-1', firstName: 'Alice' }];
    const result = deduplicateChildren([], linked);
    expect(result).toHaveLength(1);
  });

  it('should handle empty linked children', () => {
    const direct = [{ id: 'child-1', firstName: 'Alice' }];
    const result = deduplicateChildren(direct, []);
    expect(result).toHaveLength(1);
  });

  it('should handle both empty', () => {
    const result = deduplicateChildren([], []);
    expect(result).toHaveLength(0);
  });
});

describe('Parent Features - Notification Schema', () => {
  it('should accept valid delay notification', () => {
    const result = insertParentNotificationSchema.safeParse({
      companyId: 'company-1',
      routeId: 'route-1',
      type: 'delay',
      title: 'Bus Running Late',
      message: 'Bus 42 is running 15 minutes late',
      estimatedDelay: 15,
      createdById: 'admin-1',
    });
    expect(result.success).toBe(true);
  });

  it('should accept valid emergency notification', () => {
    const result = insertParentNotificationSchema.safeParse({
      companyId: 'company-1',
      type: 'emergency',
      title: 'Emergency Alert',
      message: 'All buses returning to depot due to weather',
      createdById: 'admin-1',
    });
    expect(result.success).toBe(true);
  });

  it('should accept info notification', () => {
    const result = insertParentNotificationSchema.safeParse({
      companyId: 'company-1',
      type: 'info',
      title: 'Schedule Change',
      message: 'Early dismissal on Friday',
      createdById: 'admin-1',
    });
    expect(result.success).toBe(true);
  });

  it('should accept route_change notification', () => {
    const result = insertParentNotificationSchema.safeParse({
      companyId: 'company-1',
      routeId: 'route-1',
      type: 'route_change',
      title: 'Route Modified',
      message: 'Stop at Oak St has been removed',
      createdById: 'admin-1',
    });
    expect(result.success).toBe(true);
  });
});

describe('Parent Features - Messaging Access Control', () => {
  function canAccessMessaging(role: string): boolean {
    return role === 'parent' || role === 'driver';
  }

  it('should allow parents to access messaging', () => {
    expect(canAccessMessaging('parent')).toBe(true);
  });

  it('should allow drivers to access messaging', () => {
    expect(canAccessMessaging('driver')).toBe(true);
  });

  it('should deny admins from messaging', () => {
    expect(canAccessMessaging('admin')).toBe(false);
  });

  it('should deny master_admin from messaging', () => {
    expect(canAccessMessaging('master_admin')).toBe(false);
  });

  it('should deny unknown roles from messaging', () => {
    expect(canAccessMessaging('unknown')).toBe(false);
  });
});

describe('Parent Features - Link Code System', () => {
  function canCreateLinkCode(params: {
    userRole: string;
    parentPortalEnabled: boolean;
  }): { allowed: boolean; reason?: string } {
    const isAdmin = params.userRole === 'admin' || params.userRole === 'master_admin' || params.userRole === 'driver_admin';
    if (!isAdmin) {
      return { allowed: false, reason: 'Unauthorized - admin required' };
    }
    if (!params.parentPortalEnabled) {
      return { allowed: false, reason: 'Link codes require the Parent Portal feature' };
    }
    return { allowed: true };
  }

  it('should allow admin to create link code with parent portal enabled', () => {
    const result = canCreateLinkCode({ userRole: 'admin', parentPortalEnabled: true });
    expect(result.allowed).toBe(true);
  });

  it('should reject if parent portal not enabled', () => {
    const result = canCreateLinkCode({ userRole: 'admin', parentPortalEnabled: false });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Parent Portal');
  });

  it('should reject non-admin users', () => {
    const result = canCreateLinkCode({ userRole: 'parent', parentPortalEnabled: true });
    expect(result.allowed).toBe(false);
  });

  it('should reject drivers from creating link codes', () => {
    const result = canCreateLinkCode({ userRole: 'driver', parentPortalEnabled: true });
    expect(result.allowed).toBe(false);
  });

  it('should allow driver_admin to create link codes', () => {
    const result = canCreateLinkCode({ userRole: 'driver_admin', parentPortalEnabled: true });
    expect(result.allowed).toBe(true);
  });
});

describe('Parent Features - Notification Read Tracking', () => {
  function getUnreadNotifications(
    notifications: { id: string; title: string }[],
    readIds: string[]
  ): { id: string; title: string }[] {
    const readSet = new Set(readIds);
    return notifications.filter(n => !readSet.has(n.id));
  }

  it('should return all notifications when none read', () => {
    const notifs = [{ id: 'n1', title: 'Alert 1' }, { id: 'n2', title: 'Alert 2' }];
    const result = getUnreadNotifications(notifs, []);
    expect(result).toHaveLength(2);
  });

  it('should filter out read notifications', () => {
    const notifs = [{ id: 'n1', title: 'Alert 1' }, { id: 'n2', title: 'Alert 2' }];
    const result = getUnreadNotifications(notifs, ['n1']);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n2');
  });

  it('should return empty when all read', () => {
    const notifs = [{ id: 'n1', title: 'Alert 1' }];
    const result = getUnreadNotifications(notifs, ['n1']);
    expect(result).toHaveLength(0);
  });

  it('should handle empty notifications', () => {
    const result = getUnreadNotifications([], ['n1']);
    expect(result).toHaveLength(0);
  });
});

describe('Parent Features - Stop Progress Tracking', () => {
  function getStopProgress(
    totalStops: number,
    completedStops: number,
    studentStopIndex: number
  ): { status: string; stopsAway: number } {
    if (completedStops >= studentStopIndex) {
      return { status: 'arrived', stopsAway: 0 };
    }
    return {
      status: 'en_route',
      stopsAway: studentStopIndex - completedStops,
    };
  }

  it('should show arrived when bus passed students stop', () => {
    const result = getStopProgress(10, 5, 3);
    expect(result.status).toBe('arrived');
    expect(result.stopsAway).toBe(0);
  });

  it('should show stops away when bus en route', () => {
    const result = getStopProgress(10, 2, 5);
    expect(result.status).toBe('en_route');
    expect(result.stopsAway).toBe(3);
  });

  it('should show arrived when at exact stop', () => {
    const result = getStopProgress(10, 5, 5);
    expect(result.status).toBe('arrived');
    expect(result.stopsAway).toBe(0);
  });

  it('should show all stops away at beginning of route', () => {
    const result = getStopProgress(10, 0, 8);
    expect(result.status).toBe('en_route');
    expect(result.stopsAway).toBe(8);
  });
});
