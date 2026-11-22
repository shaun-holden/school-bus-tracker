// Q149: the admin bus-location simulator (PUT /api/buses/:busId/location and the
// "Test: Simulate Bus Location" card) is on only where GPS_SIMULATOR_ENABLED is
// exactly "true" (trimmed): staging. Unset or anything else is off (fails closed).
// No imports, read at call time, so tests can flip it with vi.stubEnv.
export function gpsSimulatorEnabled(): boolean {
  return process.env.GPS_SIMULATOR_ENABLED?.trim() === 'true';
}
