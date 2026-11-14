import { DrizzleQueryError } from 'drizzle-orm';

// Helpers for drizzle-wrapped driver errors. Since drizzle 0.44 every driver
// error is wrapped in DrizzleQueryError, whose .message carries the SQL and
// its bound params, so it must never reach a client or a log line. The class
// sets no `name` and has no entityKind: detect it with instanceof only.

export interface PgErrorLike { code?: string; constraint?: string; detail?: string; message?: string }

/** True for a drizzle-wrapped driver error (its message carries SQL + params). */
export function isDbQueryError(e: unknown): e is DrizzleQueryError {
  return e instanceof DrizzleQueryError;
}

/** The underlying Postgres error: .cause of a DrizzleQueryError, or e itself if it is pg-shaped; else undefined. */
export function pgError(e: unknown): PgErrorLike | undefined {
  if (isDbQueryError(e)) {
    const cause: unknown = e.cause;
    return typeof cause === 'object' && cause !== null ? (cause as PgErrorLike) : undefined;
  }
  if (typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string') {
    return e as PgErrorLike;
  }
  return undefined;
}
