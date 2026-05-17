import { describe, it, expect } from 'vitest';
import { ALLOWED_ORIGINS } from '../server/index';

describe('CORS allowlist', () => {
  it('contains the five plan-aligned origins', () => {
    expect(ALLOWED_ORIGINS).toContain('capacitor://localhost');
    expect(ALLOWED_ORIGINS).toContain('ionic://localhost');
    expect(ALLOWED_ORIGINS).toContain('http://localhost');
    expect(ALLOWED_ORIGINS).toContain('https://www.schoolbustracker.org');
    expect(ALLOWED_ORIGINS).toContain('https://schoolbustracker.org');
  });
});
