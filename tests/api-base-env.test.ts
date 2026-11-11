import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// getApiBase() must read `import.meta.env.VITE_API_BASE_URL` literally: Vite
// only inlines that exact static form at build time. The old
// `(import.meta as any)?.env?.VITE_API_BASE_URL` was never replaced, so native
// (iOS/Android) builds always fell back to production, even staging builds.

const isNativePlatform = vi.fn(() => false);

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
  },
}));

const PROD = 'https://www.schoolbustracker.org';
const SOURCE_PATH = path.resolve(__dirname, '..', 'client', 'src', 'lib', 'apiBase.ts');

async function loadApiBase() {
  vi.resetModules();
  return import('../client/src/lib/apiBase');
}

describe('apiBase source: static import.meta.env access (Vite inlining)', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');

  it('reads import.meta.env.VITE_API_BASE_URL literally — goes red if the old `(import.meta as any)?.env?.VITE_API_BASE_URL` line returns', () => {
    expect(source).toContain('import.meta.env.VITE_API_BASE_URL');
    expect(source).not.toContain('import.meta as any');
    expect(source).not.toContain('import.meta)?.');
    expect(source).not.toContain('import.meta?.');
  });
});

describe('apiBase behaviour', () => {
  beforeEach(() => {
    isNativePlatform.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('web: getApiBase() is "" and apiUrl leaves relative paths unchanged', async () => {
    isNativePlatform.mockReturnValue(false);
    vi.stubEnv('VITE_API_BASE_URL', 'https://staging.example.test');
    const { getApiBase, apiUrl } = await loadApiBase();
    expect(getApiBase()).toBe('');
    expect(apiUrl('/api/x')).toBe('/api/x');
  });

  it('native with empty VITE_API_BASE_URL falls back to production', async () => {
    isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_API_BASE_URL', '');
    const { getApiBase, apiUrl } = await loadApiBase();
    expect(getApiBase()).toBe(PROD);
    expect(apiUrl('/api/x')).toBe(`${PROD}/api/x`);
  });

  it('native with VITE_API_BASE_URL uses it, trailing slash stripped', async () => {
    isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_API_BASE_URL', 'https://staging.example.test/');
    const { getApiBase, apiUrl } = await loadApiBase();
    expect(getApiBase()).toBe('https://staging.example.test');
    expect(apiUrl('/api/x')).toBe('https://staging.example.test/api/x');
  });

  it('native with whitespace-only VITE_API_BASE_URL falls back to production', async () => {
    isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_API_BASE_URL', '   ');
    const { getApiBase } = await loadApiBase();
    expect(getApiBase()).toBe(PROD);
  });

  it('apiUrl returns absolute URLs unchanged (native and web)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://staging.example.test');
    const { apiUrl } = await loadApiBase();
    isNativePlatform.mockReturnValue(true);
    expect(apiUrl('https://other.example.test/api/y')).toBe('https://other.example.test/api/y');
    isNativePlatform.mockReturnValue(false);
    expect(apiUrl('http://other.example.test/api/y')).toBe('http://other.example.test/api/y');
  });
});
