// WT-1 (Q49): self-registration through the real POST /api/auth/register.
// Replaces the copied getRegistrationRole in tests/role-access.test.ts (which
// wrongly said drivers may self-register). Whatever role or company the body
// asks for, the new user is a parent with no company; a driver is refused.
// Also proves the real bcrypt cost 12 (WT-6), so no unit test has to import
// server/customAuth.ts (it pulls in server/db.ts, which needs DATABASE_URL).
//
// registerLimiter allows 5 requests per IP per hour and counts every request,
// including 400s. This file makes exactly 4 register POSTs.
// Real HTTP + real Postgres.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, passwordCredentials } from '@shared/schema';
import { useIntegrationHarness } from './harness';

const h = useIntegrationHarness();
const PASSWORD = 'wt1-Register-Pass-1';

const userByEmail = async (email: string) =>
  (await h.db.select().from(users).where(eq(users.email, email)))[0];

describe('WT-1 POST /api/auth/register', () => {
  it("role 'admin' with companyId + companySlug in the body → 201, a parent with company_id NULL, password hashed at cost 12 (red if register uses the body's role or companyId, or genSalt drops below 12)", async () => {
    const email = 'wt1-admin@sbt.test';
    const res = await h.anon().post('/api/auth/register').send({
      email,
      password: PASSWORD,
      firstName: 'Wt1',
      lastName: 'Admin',
      role: 'admin',
      companyId: h.ids.companyA,
      companySlug: 'co-a',
    });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('parent');
    expect(res.body.companyId).toBeNull();

    const row = await userByEmail(email);
    expect(row.role).toBe('parent');
    expect(row.companyId).toBeNull();

    const [cred] = await h.db.select().from(passwordCredentials).where(eq(passwordCredentials.userId, row.id));
    expect(cred.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("role 'master_admin' → 201 and the row is a parent with no company (red if register uses the body's role)", async () => {
    const email = 'wt1-master@sbt.test';
    const res = await h.anon().post('/api/auth/register').send({ email, password: PASSWORD, role: 'master_admin' });
    expect(res.status).toBe(201);
    const row = await userByEmail(email);
    expect(row.role).toBe('parent');
    expect(row.companyId).toBeNull();
  });

  it("role 'driver_admin' → 201 and the row is a parent with no company (red if register uses the body's role)", async () => {
    const email = 'wt1-driver-admin@sbt.test';
    const res = await h.anon().post('/api/auth/register').send({ email, password: PASSWORD, role: 'driver_admin' });
    expect(res.status).toBe(201);
    const row = await userByEmail(email);
    expect(row.role).toBe('parent');
    expect(row.companyId).toBeNull();
  });

  it("role 'driver' → 400 with the invitation message and no user row (red if the role === 'driver' refusal is removed)", async () => {
    const email = 'wt1-driver@sbt.test';
    const res = await h.anon().post('/api/auth/register').send({ email, password: PASSWORD, role: 'driver' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Drivers join by invitation from their company administrator.' });
    expect(await userByEmail(email)).toBeUndefined();
  });
});
