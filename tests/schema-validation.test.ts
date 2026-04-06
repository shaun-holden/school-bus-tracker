import { describe, it, expect } from 'vitest';
import {
  insertStudentSchema,
  insertRouteSchema,
  insertSchoolSchema,
  insertBusSchema,
  insertVehicleIssueSchema,
  insertDriverTaskSchema,
  insertEmergencyContactSchema,
  insertAttendanceSchema,
} from '@shared/schema';

describe('Schema Validation - Students', () => {
  it('should accept valid student data', () => {
    const result = insertStudentSchema.safeParse({
      firstName: 'John',
      lastName: 'Doe',
      grade: '5th',
      parentId: 'parent-123',
      routeId: 'route-123',
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });

  it('should require firstName', () => {
    const result = insertStudentSchema.safeParse({
      lastName: 'Doe',
      parentId: 'parent-123',
      companyId: 'company-123',
    });
    expect(result.success).toBe(false);
  });

  it('should require lastName', () => {
    const result = insertStudentSchema.safeParse({
      firstName: 'John',
      parentId: 'parent-123',
      companyId: 'company-123',
    });
    expect(result.success).toBe(false);
  });

  it('should require parentId', () => {
    const result = insertStudentSchema.safeParse({
      firstName: 'Jane',
      lastName: 'Smith',
      companyId: 'company-123',
    });
    expect(result.success).toBe(false);
  });

  it('should accept student with minimal required fields', () => {
    const result = insertStudentSchema.safeParse({
      firstName: 'Jane',
      lastName: 'Smith',
      parentId: 'parent-123',
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });
});

describe('Schema Validation - Routes', () => {
  it('should accept valid route data', () => {
    const result = insertRouteSchema.safeParse({
      name: 'Route A - North Side',
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });

  it('should require route name', () => {
    const result = insertRouteSchema.safeParse({
      companyId: 'company-123',
    });
    expect(result.success).toBe(false);
  });

  it('should accept route with driver assignment', () => {
    const result = insertRouteSchema.safeParse({
      name: 'Route B',
      driverId: 'driver-123',
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });
});

describe('Schema Validation - Schools', () => {
  it('should accept valid school data', () => {
    const result = insertSchoolSchema.safeParse({
      name: 'Lincoln Elementary',
      address: '123 Main St',
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });

  it('should require school name', () => {
    const result = insertSchoolSchema.safeParse({
      address: '123 Main St',
      companyId: 'company-123',
    });
    expect(result.success).toBe(false);
  });

  it('should accept school with coordinates', () => {
    const result = insertSchoolSchema.safeParse({
      name: 'Washington High',
      address: '456 Oak Ave',
      latitude: '33.7490',
      longitude: '-84.3880',
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });
});

describe('Schema Validation - Buses', () => {
  it('should accept valid bus data', () => {
    const result = insertBusSchema.safeParse({
      busNumber: 'BUS-001',
      capacity: 48,
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });

  it('should require bus number', () => {
    const result = insertBusSchema.safeParse({
      capacity: 48,
      companyId: 'company-123',
    });
    expect(result.success).toBe(false);
  });

  it('should accept bus with status', () => {
    const result = insertBusSchema.safeParse({
      busNumber: 'BUS-002',
      capacity: 36,
      status: 'idle',
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });
});

describe('Schema Validation - Vehicle Issues', () => {
  it('should accept valid vehicle issue', () => {
    const result = insertVehicleIssueSchema.safeParse({
      busId: 'bus-123',
      driverId: 'driver-123',
      issueType: 'mechanical',
      description: 'Flat tire on rear left',
      severity: 'high',
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });

  it('should require description', () => {
    const result = insertVehicleIssueSchema.safeParse({
      busId: 'bus-123',
      driverId: 'driver-123',
      issueType: 'mechanical',
      companyId: 'company-123',
    });
    expect(result.success).toBe(false);
  });

  it('should require issueType', () => {
    const result = insertVehicleIssueSchema.safeParse({
      busId: 'bus-123',
      driverId: 'driver-123',
      description: 'Flat tire',
      companyId: 'company-123',
    });
    expect(result.success).toBe(false);
  });
});

describe('Schema Validation - Driver Tasks', () => {
  it('should accept valid driver task', () => {
    const result = insertDriverTaskSchema.safeParse({
      title: 'Pre-trip inspection',
      assignedToId: 'driver-123',
      assignedById: 'admin-123',
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });

  it('should require title', () => {
    const result = insertDriverTaskSchema.safeParse({
      assignedToId: 'driver-123',
      assignedById: 'admin-123',
      companyId: 'company-123',
    });
    expect(result.success).toBe(false);
  });

  it('should require assignedToId', () => {
    const result = insertDriverTaskSchema.safeParse({
      title: 'Pre-trip inspection',
      assignedById: 'admin-123',
      companyId: 'company-123',
    });
    expect(result.success).toBe(false);
  });
});

describe('Schema Validation - Emergency Contacts', () => {
  it('should accept valid emergency contact', () => {
    const result = insertEmergencyContactSchema.safeParse({
      studentId: 'student-123',
      name: 'Jane Doe',
      phone: '555-0123',
      relationship: 'Mother',
    });
    expect(result.success).toBe(true);
  });

  it('should require contact name', () => {
    const result = insertEmergencyContactSchema.safeParse({
      studentId: 'student-123',
      phone: '555-0123',
    });
    expect(result.success).toBe(false);
  });

  it('should require phone number', () => {
    const result = insertEmergencyContactSchema.safeParse({
      studentId: 'student-123',
      name: 'Jane Doe',
    });
    expect(result.success).toBe(false);
  });
});

describe('Schema Validation - Attendance', () => {
  it('should accept valid attendance record', () => {
    const result = insertAttendanceSchema.safeParse({
      studentId: 'student-123',
      routeId: 'route-123',
      date: new Date('2026-04-05'),
      companyId: 'company-123',
    });
    expect(result.success).toBe(true);
  });

  it('should require studentId', () => {
    const result = insertAttendanceSchema.safeParse({
      routeId: 'route-123',
      date: new Date('2026-04-05'),
    });
    expect(result.success).toBe(false);
  });

  it('should require routeId', () => {
    const result = insertAttendanceSchema.safeParse({
      studentId: 'student-123',
      date: new Date('2026-04-05'),
    });
    expect(result.success).toBe(false);
  });
});
