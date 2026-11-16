// Q80 (SB-3): appBaseUrl() is the trusted base for emailed links. It reads
// only the environment, never the request. Unit test, no DB.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appBaseUrl } from '../server/appUrl';

const KEYS = ['APP_URL', 'NODE_ENV', 'PORT'] as const;
type Key = (typeof KEYS)[number];
let saved: Partial<Record<Key, string>>;

// Assigning undefined to process.env stores the string "undefined": delete instead.
function setEnv(key: Key, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  saved = {};
  for (const k of KEYS) if (k in process.env) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of KEYS) setEnv(k, saved[k]);
});

describe('appBaseUrl (Q80)', () => {
  it('returns APP_URL when it is set (red if appBaseUrl ignores process.env.APP_URL)', () => {
    setEnv('APP_URL', 'https://trusted.example.test');
    setEnv('NODE_ENV', 'production');
    expect(appBaseUrl()).toBe('https://trusted.example.test');
  });

  it('falls back to the production site when APP_URL is unset in production', () => {
    setEnv('APP_URL', undefined);
    setEnv('NODE_ENV', 'production');
    expect(appBaseUrl()).toBe('https://www.schoolbustracker.org');
  });

  it('falls back to localhost:PORT when APP_URL is unset in development', () => {
    setEnv('APP_URL', undefined);
    setEnv('NODE_ENV', 'development');
    setEnv('PORT', '5001');
    expect(appBaseUrl()).toBe('http://localhost:5001');
  });
});
