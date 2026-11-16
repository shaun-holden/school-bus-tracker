// Public base URL of the app, for links we send out (password reset, etc.).
// Kept in its own module with no imports so tests can read it without
// booting the server or the DB. The base URL must never come from the
// request: Host and X-Forwarded-* are attacker-controlled (SB-3).

// Same expression as buildPasswordSetupUrl in routes.ts; keep identical until routes.ts uses this (Q81).
export function appBaseUrl(): string {
  return process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://www.schoolbustracker.org' : `http://localhost:${process.env.PORT || 5000}`);
}
