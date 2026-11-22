import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { gpsSimulatorEnabled } from '../server/gpsSimulator';

// Q149: the admin bus-location simulator is on only where GPS_SIMULATOR_ENABLED
// is exactly "true" (trimmed). Anything else fails closed.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Q149 gpsSimulatorEnabled() fails closed', () => {
  it('unset → false', () => {
    vi.stubEnv('GPS_SIMULATOR_ENABLED', undefined);
    expect(gpsSimulatorEnabled()).toBe(false);
  });
  it("'' → false", () => {
    vi.stubEnv('GPS_SIMULATOR_ENABLED', '');
    expect(gpsSimulatorEnabled()).toBe(false);
  });
  it("'false' → false", () => {
    vi.stubEnv('GPS_SIMULATOR_ENABLED', 'false');
    expect(gpsSimulatorEnabled()).toBe(false);
  });
  it("'TRUE' → false (strict, lowercase only)", () => {
    vi.stubEnv('GPS_SIMULATOR_ENABLED', 'TRUE');
    expect(gpsSimulatorEnabled()).toBe(false);
  });
  it("' true ' → true (trimmed)", () => {
    vi.stubEnv('GPS_SIMULATOR_ENABLED', ' true ');
    expect(gpsSimulatorEnabled()).toBe(true);
  });
  it("'true' → true", () => {
    vi.stubEnv('GPS_SIMULATOR_ENABLED', 'true');
    expect(gpsSimulatorEnabled()).toBe(true);
  });
});

// The suite has no DOM setup, so the card guard is a source scan (q141 style).
describe('Q149 the simulator card is hidden unless the server says enabled', () => {
  it('the "Test: Simulate Bus Location" card sits inside {gpsSim?.enabled === true && ( … )} (red if the condition around the card is removed)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'client/src/pages/admin-dashboard.tsx'), 'utf8');
    expect(src).toMatch(/useQuery<\{ enabled: boolean \}>\(\{\s*queryKey: \['\/api\/gps-simulator'\]/);
    // The card's own title (the last occurrence; the useQuery comment names it too).
    const title = src.lastIndexOf('Test: Simulate Bus Location');
    expect(title, 'card title present').toBeGreaterThan(-1);
    const guard = src.lastIndexOf('{gpsSim?.enabled === true && (', title);
    expect(guard, 'guard before the card').toBeGreaterThan(-1);
    // Exactly one <Card between the guard and the title: the guard wraps this card.
    const between = src.slice(guard, title);
    expect(between.match(/<Card[\s>]/g) ?? []).toHaveLength(1);
    // The guard closes after the simulate buttons.
    const after = src.slice(src.indexOf('button-simulate-location-', title));
    expect(after).toMatch(/^[^]*?<\/Card>\s*\)\}/);
  });
});
