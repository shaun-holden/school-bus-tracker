// CORS / Origin-guard allowlist. Kept in its own module with no imports so
// tests (and anything else) can read it without loading the server or the DB.
export const ALLOWED_ORIGINS = [
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://www.schoolbustracker.org',
  'https://schoolbustracker.org',
];
