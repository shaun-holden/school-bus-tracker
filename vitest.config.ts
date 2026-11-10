import { defineConfig } from 'vitest/config';
import path from 'path';

// Two projects (both inherit the root alias + globals via `extends: true`):
// - unit: tests/*.test.ts, no database.
// - integration: tests/integration/**, real HTTP + Postgres 17 on
//   TEST_DATABASE_URL. Its globalSetup hard-fails with a fix-it message when
//   TEST_DATABASE_URL is missing, so plain `npm test` (both projects) fails
//   instead of silently skipping the tenant tests.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@': path.resolve(__dirname, 'client', 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          // One test database per run: files run one at a time.
          fileParallelism: false,
          testTimeout: 20000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
