// Q2b-1: with drizzle-orm 0.45 every driver error is a DrizzleQueryError whose
// message is "Failed query: <sql> params: <values>". Error handling must read
// the Postgres code through pgError(), and no response body may ever carry
// the wrapper's SQL or params. Real HTTP + real Postgres. (E1, duplicate
// driver email 400, is covered by q42-driver-email.test.ts.)
//
// A NUL byte in a text value is a convenient REAL database error: zod accepts
// it, Postgres refuses it (22021 invalid byte sequence), drizzle wraps it.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm';
import { schools, routeSchools, routes, buses } from '@shared/schema';
import { db } from '../../server/db';
import { useIntegrationHarness, type Agent } from './harness';

const h = useIntegrationHarness();

let adminA: Agent;
let adminA2nd: Agent;
let schoolX: string;

const noSql = (body: unknown) => {
  const text = JSON.stringify(body);
  expect(text).not.toContain('Failed query');
  expect(text).not.toContain('params:');
  expect(text).not.toMatch(/\b(select|insert|update)\b.*"/i);
};

beforeAll(async () => {
  const [s] = await h.db.insert(schools).values({ companyId: h.ids.companyA, name: 'A-SchoolX', address: 'A-9 Rd' }).returning({ id: schools.id });
  schoolX = s.id;
  // 2 logins (MAX_LOGINS_PER_FILE is 8).
  adminA = await h.loginAs('adminA');
  adminA2nd = await h.loginAs('adminA');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('E2 POST /api/routes/:routeId/schools/:schoolId', () => {
  it('adding the same school to a route twice → 201 then 409 (red if the 23505 check reads error.code instead of pgError(error).code)', async () => {
    const first = await adminA.post(`/api/routes/${h.ids.routeA}/schools/${schoolX}`);
    expect(first.status).toBe(201);
    const second = await adminA.post(`/api/routes/${h.ids.routeA}/schools/${schoolX}`);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ message: 'School already assigned to this route' });
    const links = await h.db.select().from(routeSchools).where(and(eq(routeSchools.routeId, h.ids.routeA), eq(routeSchools.schoolId, schoolX)));
    expect(links).toHaveLength(1);
  });
});

describe('E7 POST / PATCH /api/routes', () => {
  it('PATCH with a name Postgres rejects (NUL byte) → no SQL or params in the body (red if the DB error goes back into details)', async () => {
    const res = await adminA.patch(`/api/routes/${h.ids.routeA}`).send({ name: 'Bad\u0000Name' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    noSql(res.body);
    const [row] = await h.db.select().from(routes).where(eq(routes.id, h.ids.routeA));
    expect(row.name).toBe('A-Route');
  });

  it('POST with a name Postgres rejects → no SQL or params in the body', async () => {
    const res = await adminA.post('/api/routes').send({ name: 'New\u0000Route' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    noSql(res.body);
  });

  it('a zod validation error still returns its details (unchanged)', async () => {
    const res = await adminA.patch(`/api/routes/${h.ids.routeA}`).send({ estimatedDuration: 'not-a-number' });
    expect(res.status).toBe(400);
    expect(res.body.details ?? res.body.errors).toBeTruthy();
  });
});

describe('E4/E5 POST /api/buses', () => {
  it('a bus number Postgres rejects → 500 with no SQL, params or echoed request data', async () => {
    const res = await adminA.post('/api/buses').send({ busNumber: 'Q2B\u0000BUS' });
    expect(res.status).toBe(500);
    noSql(res.body);
    expect(res.body.requestData).toBeUndefined();
    expect(await h.db.select().from(buses).where(eq(buses.busNumber, 'Q2B'))).toHaveLength(0);
  });
});

describe('E8 global error handler', () => {
  it('a DrizzleQueryError from the session user lookup (deserializeUser) → 500 { message: "Internal Server Error" }, no SQL (red if the DB-error branch is removed)', async () => {
    const pgCause = Object.assign(new Error('connection terminated'), { code: '57P01' });
    const spy = vi.spyOn(db, 'select').mockImplementationOnce(() => {
      throw new DrizzleQueryError('select "users"."id", "users"."email" from "users" where "users"."id" = $1', [h.ids.adminA], pgCause);
    });
    const res = await adminA2nd.get('/api/auth/user');
    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Internal Server Error' });
    noSql(res.body);
    expect(JSON.stringify(res.body)).not.toContain(h.ids.adminA);
  });
});
