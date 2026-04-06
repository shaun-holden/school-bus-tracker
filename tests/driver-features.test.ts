import { describe, it, expect } from 'vitest';
import { updateDriverProfileSchema } from '@shared/schema';

describe('Driver Features - Bus Selection Validation', () => {
  function canSelectBus(busStatus: string, busDriverId: string | null, requestingDriverId: string): { allowed: boolean; reason?: string } {
    if (busStatus === 'maintenance') {
      return { allowed: false, reason: 'Bus is under maintenance and cannot be selected' };
    }
    if (busDriverId && busDriverId !== requestingDriverId) {
      return { allowed: false, reason: 'Bus is already assigned to another driver' };
    }
    return { allowed: true };
  }

  it('should allow selecting an idle bus with no driver', () => {
    const result = canSelectBus('idle', null, 'driver-1');
    expect(result.allowed).toBe(true);
  });

  it('should allow re-selecting own assigned bus', () => {
    const result = canSelectBus('idle', 'driver-1', 'driver-1');
    expect(result.allowed).toBe(true);
  });

  it('should reject bus under maintenance', () => {
    const result = canSelectBus('maintenance', null, 'driver-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('maintenance');
  });

  it('should reject bus assigned to another driver', () => {
    const result = canSelectBus('idle', 'driver-2', 'driver-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('another driver');
  });

  it('should reject maintenance bus even if assigned to requesting driver', () => {
    const result = canSelectBus('maintenance', 'driver-1', 'driver-1');
    expect(result.allowed).toBe(false);
  });
});

describe('Driver Features - Route Activation', () => {
  function canActivateRoute(busAssigned: boolean, busStatus: string): { allowed: boolean; reason?: string } {
    if (!busAssigned) {
      return { allowed: false, reason: 'No bus assigned to driver' };
    }
    if (busStatus === 'on_route') {
      return { allowed: false, reason: 'Route already active' };
    }
    if (busStatus === 'maintenance' || busStatus === 'inactive') {
      return { allowed: false, reason: 'Bus is not available for route' };
    }
    return { allowed: true };
  }

  it('should allow activating route with assigned idle bus', () => {
    expect(canActivateRoute(true, 'idle').allowed).toBe(true);
  });

  it('should reject activation without assigned bus', () => {
    const result = canActivateRoute(false, 'idle');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No bus assigned');
  });

  it('should reject if route already active', () => {
    const result = canActivateRoute(true, 'on_route');
    expect(result.allowed).toBe(false);
  });

  it('should reject if bus in maintenance', () => {
    const result = canActivateRoute(true, 'maintenance');
    expect(result.allowed).toBe(false);
  });

  it('should reject if bus inactive', () => {
    const result = canActivateRoute(true, 'inactive');
    expect(result.allowed).toBe(false);
  });
});

describe('Driver Features - Duty Status & Shift Reports', () => {
  function calculateShiftDuration(startTime: Date, endTime: Date): number {
    return Math.floor((endTime.getTime() - startTime.getTime()) / (1000 * 60));
  }

  it('should calculate shift duration in minutes', () => {
    const start = new Date('2026-04-05T08:00:00');
    const end = new Date('2026-04-05T16:00:00');
    expect(calculateShiftDuration(start, end)).toBe(480); // 8 hours
  });

  it('should handle short shifts', () => {
    const start = new Date('2026-04-05T08:00:00');
    const end = new Date('2026-04-05T08:30:00');
    expect(calculateShiftDuration(start, end)).toBe(30);
  });

  it('should handle zero duration shifts', () => {
    const now = new Date();
    expect(calculateShiftDuration(now, now)).toBe(0);
  });

  function generateShiftReport(params: {
    driverId: string;
    driverName: string;
    startTime: Date;
    endTime: Date;
    busNumber: string | null;
    schoolsVisited: number;
    studentsPickedUp: number;
    studentsDroppedOff: number;
    issuesReported: number;
    fuelLevel: string | null;
    interiorClean: boolean;
    exteriorClean: boolean;
  }) {
    const duration = Math.floor((params.endTime.getTime() - params.startTime.getTime()) / (1000 * 60));
    return {
      driverId: params.driverId,
      driverName: params.driverName,
      busNumber: params.busNumber,
      totalDurationMinutes: duration,
      schoolsVisitedCount: params.schoolsVisited,
      studentsPickedUp: params.studentsPickedUp,
      studentsDroppedOff: params.studentsDroppedOff,
      issuesReportedCount: params.issuesReported,
      preShiftFuelLevel: params.fuelLevel,
      preShiftInteriorClean: params.interiorClean,
      preShiftExteriorClean: params.exteriorClean,
    };
  }

  it('should generate complete shift report', () => {
    const report = generateShiftReport({
      driverId: 'driver-1',
      driverName: 'John Smith',
      startTime: new Date('2026-04-05T07:00:00'),
      endTime: new Date('2026-04-05T15:00:00'),
      busNumber: 'BUS-001',
      schoolsVisited: 3,
      studentsPickedUp: 25,
      studentsDroppedOff: 25,
      issuesReported: 0,
      fuelLevel: '75',
      interiorClean: true,
      exteriorClean: true,
    });

    expect(report.driverId).toBe('driver-1');
    expect(report.totalDurationMinutes).toBe(480);
    expect(report.schoolsVisitedCount).toBe(3);
    expect(report.studentsPickedUp).toBe(25);
    expect(report.preShiftFuelLevel).toBe('75');
    expect(report.preShiftInteriorClean).toBe(true);
  });

  it('should handle shift with no bus assigned', () => {
    const report = generateShiftReport({
      driverId: 'driver-1',
      driverName: 'John Smith',
      startTime: new Date('2026-04-05T07:00:00'),
      endTime: new Date('2026-04-05T09:00:00'),
      busNumber: null,
      schoolsVisited: 0,
      studentsPickedUp: 0,
      studentsDroppedOff: 0,
      issuesReported: 0,
      fuelLevel: null,
      interiorClean: false,
      exteriorClean: false,
    });

    expect(report.busNumber).toBeNull();
    expect(report.preShiftFuelLevel).toBeNull();
  });
});

describe('Driver Features - Check-In Validation', () => {
  function validateCheckIn(data: {
    driverId?: string;
    fuelLevel?: string;
    interiorClean?: boolean;
    exteriorClean?: boolean;
  }): { valid: boolean; reason?: string } {
    if (!data.driverId) {
      return { valid: false, reason: 'Driver selection is required' };
    }
    return { valid: true };
  }

  it('should accept valid check-in data', () => {
    const result = validateCheckIn({
      driverId: 'driver-1',
      fuelLevel: '80',
      interiorClean: true,
      exteriorClean: true,
    });
    expect(result.valid).toBe(true);
  });

  it('should reject check-in without driver ID', () => {
    const result = validateCheckIn({
      fuelLevel: '80',
      interiorClean: true,
      exteriorClean: true,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Driver selection');
  });
});

describe('Driver Features - Location Update Validation', () => {
  function validateLocationUpdate(data: { latitude?: number; longitude?: number; speed?: number }): { valid: boolean; reason?: string } {
    if (!data.latitude || !data.longitude) {
      return { valid: false, reason: 'Latitude and longitude are required' };
    }
    if (data.latitude < -90 || data.latitude > 90) {
      return { valid: false, reason: 'Invalid latitude' };
    }
    if (data.longitude < -180 || data.longitude > 180) {
      return { valid: false, reason: 'Invalid longitude' };
    }
    return { valid: true };
  }

  it('should accept valid GPS coordinates', () => {
    const result = validateLocationUpdate({ latitude: 33.749, longitude: -84.388 });
    expect(result.valid).toBe(true);
  });

  it('should accept coordinates with speed', () => {
    const result = validateLocationUpdate({ latitude: 33.749, longitude: -84.388, speed: 35 });
    expect(result.valid).toBe(true);
  });

  it('should reject missing latitude', () => {
    const result = validateLocationUpdate({ longitude: -84.388 });
    expect(result.valid).toBe(false);
  });

  it('should reject missing longitude', () => {
    const result = validateLocationUpdate({ latitude: 33.749 });
    expect(result.valid).toBe(false);
  });

  it('should reject invalid latitude', () => {
    const result = validateLocationUpdate({ latitude: 100, longitude: -84.388 });
    expect(result.valid).toBe(false);
  });

  it('should reject invalid longitude', () => {
    const result = validateLocationUpdate({ latitude: 33.749, longitude: -200 });
    expect(result.valid).toBe(false);
  });
});

describe('Driver Features - Profile Update Schema', () => {
  it('should accept valid driver profile update', () => {
    const result = updateDriverProfileSchema.safeParse({
      firstName: 'John',
      lastName: 'Smith',
      phone: '5550123456',
    });
    expect(result.success).toBe(true);
  });

  it('should accept profile with license info', () => {
    const result = updateDriverProfileSchema.safeParse({
      licenseNumber: 'DL-12345',
      licenseExpiryDate: '2027-01-01',
    });
    expect(result.success).toBe(true);
  });
});

describe('Driver Features - Route Authorization', () => {
  function isDriverAssignedToRoute(driverRoutes: { id: string }[], routeId: string): boolean {
    return driverRoutes.some(r => r.id === routeId);
  }

  it('should confirm driver assigned to route', () => {
    const routes = [{ id: 'route-1' }, { id: 'route-2' }];
    expect(isDriverAssignedToRoute(routes, 'route-1')).toBe(true);
  });

  it('should deny driver not assigned to route', () => {
    const routes = [{ id: 'route-1' }];
    expect(isDriverAssignedToRoute(routes, 'route-3')).toBe(false);
  });

  it('should handle driver with no routes', () => {
    expect(isDriverAssignedToRoute([], 'route-1')).toBe(false);
  });
});

describe('Driver Features - Stop Completion Tracking', () => {
  function getRouteProgress(totalStops: number, completedStops: number): { percentage: number; remaining: number } {
    if (totalStops === 0) return { percentage: 0, remaining: 0 };
    return {
      percentage: Math.round((completedStops / totalStops) * 100),
      remaining: totalStops - completedStops,
    };
  }

  it('should calculate 0% with no stops completed', () => {
    const progress = getRouteProgress(10, 0);
    expect(progress.percentage).toBe(0);
    expect(progress.remaining).toBe(10);
  });

  it('should calculate 50% with half stops completed', () => {
    const progress = getRouteProgress(10, 5);
    expect(progress.percentage).toBe(50);
    expect(progress.remaining).toBe(5);
  });

  it('should calculate 100% with all stops completed', () => {
    const progress = getRouteProgress(10, 10);
    expect(progress.percentage).toBe(100);
    expect(progress.remaining).toBe(0);
  });

  it('should handle route with no stops', () => {
    const progress = getRouteProgress(0, 0);
    expect(progress.percentage).toBe(0);
    expect(progress.remaining).toBe(0);
  });

  it('should round percentage correctly', () => {
    const progress = getRouteProgress(3, 1);
    expect(progress.percentage).toBe(33);
  });
});
