import { describe, it, expect } from 'vitest';
import { updateDriverProfileSchema, updateRouteSchema } from '@shared/schema';

// HF2 (SEC-1 / SEC-2 / SEC-14): mass-assignment allow-lists.
// These import the REAL schemas used by:
//   POST /api/drivers, PATCH /api/drivers/:id, PUT /api/driver/profile
//   PATCH /api/routes/:id

const DRIVER_PROFILE_ALLOW_LIST = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'address',
  'licenseNumber',
  'licenseState',
  'licenseExpiryDate',
  'dateOfBirth',
  'emergencyContactName',
  'emergencyContactPhone',
  'hireDate',
] as const;

// A valid value for every allow-listed field
const VALID_DRIVER_VALUES: Record<(typeof DRIVER_PROFILE_ALLOW_LIST)[number], string> = {
  firstName: 'Jane',
  lastName: 'Driver',
  email: 'jane.driver@example.com',
  phone: '5550123456',
  address: '1 Depot Rd',
  licenseNumber: 'DL-12345',
  licenseState: 'GA',
  licenseExpiryDate: '2028-01-01',
  dateOfBirth: '1985-05-05',
  emergencyContactName: 'John Driver',
  emergencyContactPhone: '5550987654',
  hireDate: '2024-08-01',
};

// Fields that must never be settable through the driver profile schema,
// with an attacker-style value for each.
const FORBIDDEN_DRIVER_FIELDS: Record<string, unknown> = {
  id: 'other-user-id',
  companyId: 'victim-company-id',
  companyRoleId: 'victim-role-id',
  departmentId: 'victim-dept-id',
  role: 'admin',
  isActive: true,
  isOnDuty: true,
  dutyStartTime: new Date(),
  assignedRouteId: 'victim-route-id',
  lastCheckInFuelLevel: 'Full',
  lastCheckInInteriorClean: true,
  lastCheckInExteriorClean: true,
  lastCheckInTime: new Date(),
  profileImageUrl: 'https://evil.example.com/x.png',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// The exact payload shape the admin dashboard driverSchema sends
// (client/src/pages/admin-dashboard.tsx), with the emergency fields filled in
// (blank emergency fields are a pre-existing 400, see HF2 item 1).
const ADMIN_FORM_PAYLOAD = {
  firstName: 'Jane',
  lastName: 'Driver',
  email: 'jane.driver@example.com',
  phone: '5550123456',
  address: '1 Depot Rd',
  licenseNumber: 'DL-12345',
  licenseState: 'GA',
  licenseExpiryDate: '2028-01-01',
  hireDate: '2024-08-01',
  emergencyContactName: 'John Driver',
  emergencyContactPhone: '5550987654',
};

describe('HF2 - updateDriverProfileSchema allow-list', () => {
  it('has exactly the allow-listed keys (adding or removing any field in .pick() turns this red)', () => {
    expect(Object.keys(updateDriverProfileSchema.shape).sort()).toEqual([...DRIVER_PROFILE_ALLOW_LIST].sort());
  });

  for (const field of DRIVER_PROFILE_ALLOW_LIST) {
    it(`keeps allow-listed field "${field}" (removing "${field}" from .pick() turns this red)`, () => {
      const value = VALID_DRIVER_VALUES[field];
      const result = updateDriverProfileSchema.safeParse({ [field]: value });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>)[field]).toBe(value);
      }
    });
  }

  for (const [field, value] of Object.entries(FORBIDDEN_DRIVER_FIELDS)) {
    it(`strips forbidden field "${field}" (adding "${field}" to .pick() turns this red)`, () => {
      const result = updateDriverProfileSchema.safeParse({ firstName: 'Jane', [field]: value });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty(field);
      }
    });

    it(`strips forbidden field "${field}" in the .partial() variant used by PATCH /api/drivers/:id`, () => {
      const result = updateDriverProfileSchema.partial().safeParse({ [field]: value });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty(field);
      }
    });
  }

  it('accepts the real admin form payload and keeps every field it sends (each one must stay in .pick())', () => {
    const result = updateDriverProfileSchema.safeParse(ADMIN_FORM_PAYLOAD);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(ADMIN_FORM_PAYLOAD);
    }
  });

  it('admin form payload with a tenant-escalation attempt keeps only the allow-listed fields', () => {
    const result = updateDriverProfileSchema.partial().safeParse({
      ...ADMIN_FORM_PAYLOAD,
      companyId: 'victim-company-id',
      isActive: true,
      assignedRouteId: 'victim-route-id',
      role: 'admin',
      companyRoleId: 'victim-role-id',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(ADMIN_FORM_PAYLOAD);
    }
  });

  it('still applies the field refinements (email format)', () => {
    expect(updateDriverProfileSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
});

describe('HF2 - updateRouteSchema (PATCH /api/routes/:id)', () => {
  it('strips companyId (adding companyId back to the update schema turns this red)', () => {
    const result = updateRouteSchema.safeParse({ name: 'Route 1', companyId: 'victim-company-id' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('companyId');
      expect(result.data.name).toBe('Route 1');
    }
  });

  it('does not include companyId in its shape', () => {
    expect(Object.keys(updateRouteSchema.shape)).not.toContain('companyId');
  });

  it('is partial: an empty body is valid', () => {
    expect(updateRouteSchema.safeParse({}).success).toBe(true);
  });

  it('keeps driverId and schoolId so the handler can tenant-check them', () => {
    const result = updateRouteSchema.safeParse({ driverId: 'driver-1', schoolId: 'school-1' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.driverId).toBe('driver-1');
      expect(result.data.schoolId).toBe('school-1');
    }
  });

  it('turns schoolId "" (the client\'s "remove school" signal) into null (red if the preprocess(\'\' → null) on updateRouteSchema.schoolId is removed)', () => {
    const result = updateRouteSchema.safeParse({ schoolId: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schoolId).toBeNull();
    }
  });
});
