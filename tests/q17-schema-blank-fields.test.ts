// Q17a / Q17c: a blank form field ("") clears the value instead of failing
// .min() (driver profile) or being written into a foreign-key column (route).
// Each title names the clause whose deletion turns it red.
import { describe, it, expect } from 'vitest';
import {
  updateDriverProfileSchema,
  updateRouteSchema,
  insertBusSchema,
} from '@shared/schema';

const BLANKABLE = [
  'email',
  'phone',
  'licenseNumber',
  'licenseState',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;

describe('Q17a updateDriverProfileSchema: blank fields', () => {
  for (const field of BLANKABLE) {
    it(`preprocess('' → null) on ${field}: blank passes and becomes null`, () => {
      const result = updateDriverProfileSchema.safeParse({ [field]: '' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field]).toBeNull();
      }
    });

    it(`preprocess('' → null) on ${field} (.partial(), the PATCH /api/drivers/:id path): blank becomes null`, () => {
      const result = updateDriverProfileSchema.partial().safeParse({ [field]: '' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field]).toBeNull();
      }
    });
  }

  it("all six blank at once (the admin form's empty emergency section) passes", () => {
    const body = Object.fromEntries(BLANKABLE.map((f) => [f, '']));
    const result = updateDriverProfileSchema.safeParse({ firstName: 'Test', lastName: 'Driver', ...body });
    expect(result.success).toBe(true);
  });

  it('an absent field stays absent (not null), so a partial edit does not clear it', () => {
    const result = updateDriverProfileSchema.partial().safeParse({ firstName: 'Test' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('emergencyContactPhone' in result.data).toBe(false);
      expect(result.data.emergencyContactPhone).toBeUndefined();
    }
  });

  it('filled-in values still pass through unchanged', () => {
    const result = updateDriverProfileSchema.safeParse({
      phone: '5555550123',
      emergencyContactName: 'A',
      emergencyContactPhone: '5555550124',
      licenseState: 'TX',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe('5555550123');
      expect(result.data.emergencyContactName).toBe('A');
      expect(result.data.emergencyContactPhone).toBe('5555550124');
      expect(result.data.licenseState).toBe('TX');
    }
  });

  it('.min(10) on phone: a 1-character phone is still rejected', () => {
    expect(updateDriverProfileSchema.safeParse({ phone: '5' }).success).toBe(false);
  });

  it('.min(10) on emergencyContactPhone: a 9-digit phone is still rejected', () => {
    expect(updateDriverProfileSchema.safeParse({ emergencyContactPhone: '555555012' }).success).toBe(false);
  });

  it('.min(2) on licenseState: a 1-character state is still rejected', () => {
    expect(updateDriverProfileSchema.safeParse({ licenseState: 'T' }).success).toBe(false);
  });

  it('.email() on email: a malformed email is still rejected', () => {
    expect(updateDriverProfileSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('a whitespace-only emergency phone is not treated as blank and is rejected by .min(10)', () => {
    expect(updateDriverProfileSchema.safeParse({ emergencyContactPhone: ' ' }).success).toBe(false);
  });

  it('SEC-1/SEC-2 .pick() allow-list: companyId, role and isActive are still stripped', () => {
    for (const schema of [updateDriverProfileSchema, updateDriverProfileSchema.partial()]) {
      const result = schema.safeParse({
        phone: '',
        companyId: 'company-b',
        role: 'admin',
        isActive: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('companyId');
        expect(result.data).not.toHaveProperty('role');
        expect(result.data).not.toHaveProperty('isActive');
      }
    }
  });

  it('SEC-1/SEC-2 .pick() allow-list: the shape keys are exactly the 12 allow-listed fields', () => {
    expect(Object.keys(updateDriverProfileSchema.shape).sort()).toEqual(
      [
        'address',
        'dateOfBirth',
        'email',
        'emergencyContactName',
        'emergencyContactPhone',
        'firstName',
        'hireDate',
        'lastName',
        'licenseExpiryDate',
        'licenseNumber',
        'licenseState',
        'phone',
      ].sort(),
    );
  });
});

describe('Q17c updateRouteSchema: blank foreign keys', () => {
  it("preprocess('' → null) on updateRouteSchema.schoolId: blank becomes null", () => {
    const result = updateRouteSchema.safeParse({ schoolId: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schoolId).toBeNull();
    }
  });

  it("preprocess('' → null) on updateRouteSchema.driverId: blank becomes null", () => {
    const result = updateRouteSchema.safeParse({ driverId: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.driverId).toBeNull();
    }
  });

  it('real ids pass through unchanged and absent ids stay absent', () => {
    const result = updateRouteSchema.safeParse({ schoolId: 'school-1', name: 'R' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schoolId).toBe('school-1');
      expect('driverId' in result.data).toBe(false);
    }
  });

  it('SEC-14 .omit({ companyId: true }): companyId is still stripped', () => {
    const result = updateRouteSchema.safeParse({ schoolId: '', companyId: 'company-b' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('companyId');
    }
  });

  it('insertBusSchema is untouched: driverId "" is kept as "" (the bus PATCH relies on it)', () => {
    const result = insertBusSchema.partial().safeParse({ driverId: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.driverId).toBe('');
    }
  });
});
