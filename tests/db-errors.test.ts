// Q2b-1: server/dbErrors.ts. Since drizzle-orm 0.44 every driver error is
// wrapped in DrizzleQueryError (message = "Failed query: <sql> params: <values>",
// the Postgres error on .cause). The class sets no `name`, so detection must
// use instanceof (or duck-typing), never e.name. Pure unit tests, no DB.
import { describe, it, expect } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { z } from 'zod';
import { pgError, isDbQueryError } from '../server/dbErrors';

const pgDup = Object.assign(new Error('duplicate key value violates unique constraint "users_email_unique"'), {
  code: '23505',
  constraint: 'users_email_unique',
});
const wrapped = new DrizzleQueryError('update "users" set "email" = $1 where "id" = $2', ['x@example.test', 'u1'], pgDup);

describe('pgError', () => {
  it('returns .cause for a wrapped DrizzleQueryError (red if the helper reads the wrapper instead)', () => {
    expect(pgError(wrapped)).toBe(pgDup);
    expect(pgError(wrapped)?.code).toBe('23505');
    expect(pgError(wrapped)?.constraint).toBe('users_email_unique');
  });

  it('returns the error itself for a plain pg-shaped error (0.39 shape)', () => {
    expect(pgError(pgDup)).toBe(pgDup);
  });

  it('a wrapped non-pg cause (connection refused) is not reported as 23505', () => {
    const conn = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    const e = new DrizzleQueryError('select 1', [], conn);
    expect(pgError(e)?.code).toBe('ECONNREFUSED');
    expect(pgError(e)?.code).not.toBe('23505');
    expect(pgError(e)?.constraint).toBeUndefined();
  });

  it('returns undefined for a plain Error and for non-objects', () => {
    expect(pgError(new Error('boom'))).toBeUndefined();
    expect(pgError('boom')).toBeUndefined();
    expect(pgError(undefined)).toBeUndefined();
  });
});

describe('isDbQueryError', () => {
  it('is true for a real DrizzleQueryError, whose name is just "Error" (red if detection uses e.name)', () => {
    expect(wrapped.name).toBe('Error');
    expect(isDbQueryError(wrapped)).toBe(true);
  });

  it('is false for a ZodError, a plain Error and a pg-shaped error', () => {
    const zodError = z.object({ a: z.string() }).safeParse({}).error;
    expect(isDbQueryError(zodError)).toBe(false);
    expect(isDbQueryError(new Error('Failed query: fake'))).toBe(false);
    expect(isDbQueryError(pgDup)).toBe(false);
  });
});
