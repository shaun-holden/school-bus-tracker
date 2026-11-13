// Integration setupFiles entry: runs in each test worker before every
// integration test file, and before anything imports server/.
//
// server/db.ts reads DATABASE_URL at import time, so it is pointed at the test
// DB here, unconditionally (a DATABASE_URL in .env must never win).
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { vi } from 'vitest';
import { assertTestDatabaseUrl } from './db-guard';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

// Guard the URL as loaded (this also refuses NODE_ENV=production from the shell or .env).
assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'integration-only-session-secret';

assertTestDatabaseUrl(process.env.DATABASE_URL);

// Factory mocks (not automock: automock still evaluates pushService.ts, which
// imports firebase-admin). Every export is replaced; nothing sends email/push.
vi.mock('../../server/emailService', () => ({
  sendPasswordResetEmail: vi.fn(async () => ({ success: true })),
  sendNewBusinessSignupNotification: vi.fn(async () => ({ success: true })),
  sendDriverInvitationEmail: vi.fn(async () => ({ success: true })),
  sendEmployeeInvitationEmail: vi.fn(async () => ({ success: true })),
}));

// Every export of server/pushService.ts is listed here, and
// tests/push-service.test.ts ("integration mock is complete") fails if a
// new export or public method is added without a mock entry here.
vi.mock('../../server/pushService', () => {
  const pushService = {
    sendToDevices: vi.fn(async () => [] as boolean[]),
    sendToDevice: vi.fn(async () => false),
    sendToUser: vi.fn(async () => undefined),
    sendToUsers: vi.fn(async () => undefined),
    notifyParentsOfAlert: vi.fn(async () => undefined),
    notifyUsersOfAlert: vi.fn(async () => undefined),
    notifyNewMessage: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  return {
    pushService,
    PushService: vi.fn(() => pushService),
    resolveApnsHost: vi.fn(() => null),
    APNS_HOSTS: { sandbox: 'api.sandbox.push.apple.com', production: 'api.push.apple.com' },
    APNS_TIMEOUT_MS: 10_000,
    FCM_TIMEOUT_MS: 10_000,
    APNS_MAX_STREAMS: 100,
    FCM_BATCH_SIZE: 500,
  };
});
