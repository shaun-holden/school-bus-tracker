// Q42: a driver's existing email can't be removed on edit (admin PATCH
// /api/drivers/:id or driver self-edit PUT /api/driver/profile). Since Q17,
// updateDriverProfileSchema turns email "" into null, which would have
// erased the driver's login. A driver with no email can still be edited
// (blank stays a no-op), a real new email still saves, and create with a
// blank email still makes a driver without one. Real HTTP + real Postgres.
// Tenant guards are untouched by Q42 (no new cross-tenant test needed).
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, driverInvitations } from '@shared/schema';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();
const BLOCKED = { message: "A driver's email can't be removed" };

let adminA: Agent;
let adminA2: Agent;
let driverA: Agent;
let noEmailDriverId: string;

const getUser = async (id: string) => (await h.db.select().from(users).where(eq(users.id, id)))[0];

beforeAll(async () => {
  const [row] = await h.db
    .insert(users)
    .values({ email: null, firstName: 'A-NoEmail', lastName: 'Driver', role: 'driver', companyId: h.ids.companyA })
    .returning({ id: users.id });
  noEmailDriverId = row.id;

  // 3 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  adminA2 = await h.loginAs('adminA2');
  driverA = await h.loginAs('driverA');
});

describe('Q42 admin PATCH /api/drivers/:id', () => {
  it('email "" on a driver who has an email → 400 and the email is unchanged (red if the PATCH check is removed)', async () => {
    const before = (await getUser(h.ids.driverA2)).email;
    expect(before).toBeTruthy();
    const res = await adminA.patch(`/api/drivers/${h.ids.driverA2}`).send({ email: '' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(BLOCKED);
    expect((await getUser(h.ids.driverA2)).email).toBe(before);
  });

  it('email null on a driver who has an email → 400 and the email is unchanged', async () => {
    const before = (await getUser(h.ids.driverA2)).email;
    const res = await adminA.patch(`/api/drivers/${h.ids.driverA2}`).send({ email: null, phone: '5559990000' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(BLOCKED);
    const after = await getUser(h.ids.driverA2);
    expect(after.email).toBe(before);
    expect(after.phone).not.toBe('5559990000');
  });

  it('a driver with no email: email "" plus a phone change → 200, phone saved, email still null', async () => {
    const res = await adminA.patch(`/api/drivers/${noEmailDriverId}`).send({ email: '', phone: '5551234567' });
    expect(res.status).toBe(200);
    const row = await getUser(noEmailDriverId);
    expect(row.phone).toBe('5551234567');
    expect(row.email).toBeNull();
  });

  it('a missing email key leaves the email unchanged', async () => {
    const before = (await getUser(h.ids.driverA2)).email;
    const res = await adminA.patch(`/api/drivers/${h.ids.driverA2}`).send({ phone: '5557654321' });
    expect(res.status).toBe(200);
    expect((await getUser(h.ids.driverA2)).email).toBe(before);
  });

  it('a valid new email → 200 and changed; another user\'s email is still the duplicate 400', async () => {
    const res = await adminA.patch(`/api/drivers/${h.ids.driverA2}`).send({ email: 'q42-new-a2@sbt.test' });
    expect(res.status).toBe(200);
    expect((await getUser(h.ids.driverA2)).email).toBe('q42-new-a2@sbt.test');
    const dup = await adminA.patch(`/api/drivers/${h.ids.driverA2}`).send({ email: 'admin-a@sbt.test' });
    expect(dup.status).toBe(400);
    expect(dup.body).toEqual({ message: 'This email address is already in use by another user' });
  });
});

describe('Q42 driver PUT /api/driver/profile', () => {
  it('a driver clearing their own email ("" ) → 400 and the email is unchanged (red if the PUT check is removed)', async () => {
    const before = (await getUser(h.ids.driverA)).email;
    expect(before).toBeTruthy();
    const res = await driverA.put('/api/driver/profile').send({ email: '' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(BLOCKED);
    expect((await getUser(h.ids.driverA)).email).toBe(before);
  });

  it('a driver editing only their phone → 200, email unchanged', async () => {
    const before = (await getUser(h.ids.driverA)).email;
    const res = await driverA.put('/api/driver/profile').send({ phone: '5552223333' });
    expect(res.status).toBe(200);
    const row = await getUser(h.ids.driverA);
    expect(row.phone).toBe('5552223333');
    expect(row.email).toBe(before);
  });
});

describe('Q42 create is unchanged', () => {
  it('POST /api/drivers with email "" → 200, a driver with no email and no invitation row', async () => {
    const res = await adminA2.post('/api/drivers').send({ firstName: 'A2-New', lastName: 'Driver', email: '' });
    expect(res.status).toBe(200);
    const row = await getUser(res.body.id);
    expect(row.email).toBeNull();
    expect(row.companyId).toBe(h.ids.companyA2);
    expect(await h.db.select().from(driverInvitations).where(eq(driverInvitations.driverId, res.body.id))).toHaveLength(0);
  });
});
