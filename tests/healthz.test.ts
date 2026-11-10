import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// `server/index.ts` cannot be imported here: on import it seeds the master
// admin and starts listening (see tests/webhook-ordering.test.ts). So, like
// that test, this reads the source as text and asserts registration order.
// A real HTTP test of GET /healthz (200 with a DB, 503 without) comes with the
// Q4 HTTP/DB harness.
//
// Invariants under guard:
// - /healthz is registered before registerRoutes(app) and before the
//   Vite/static SPA setup, so the SPA catch-all can never shadow it (a
//   shadowed health check would return index.html with a 200 and Railway
//   would mark a broken deploy healthy).
// - It pings the database through the shared `pool` from server/db.ts.
// - Its body is fixed ({ ok: true } / { ok: false }) and never carries
//   error details.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('server/index.ts /healthz', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../server/index.ts'),
    'utf-8',
  );

  const healthzIndex = source.search(/app\.get\(\s*['"`]\/healthz['"`]/);
  const registerRoutesIndex = source.indexOf('registerRoutes(app)');
  const setupViteIndex = source.indexOf('setupVite(app');
  const serveStaticIndex = source.indexOf('serveStatic(app');
  const webhookIndex = source.search(/['"`]\/api\/stripe\/webhook['"`]/);
  const corsIndex = source.indexOf('cors(');

  it('registers GET /healthz before routes and the Vite/static SPA setup', () => {
    expect(healthzIndex).toBeGreaterThanOrEqual(0);
    expect(registerRoutesIndex).toBeGreaterThanOrEqual(0);
    expect(setupViteIndex).toBeGreaterThanOrEqual(0);
    expect(serveStaticIndex).toBeGreaterThanOrEqual(0);

    expect(healthzIndex).toBeLessThan(registerRoutesIndex);
    expect(healthzIndex).toBeLessThan(setupViteIndex);
    expect(healthzIndex).toBeLessThan(serveStaticIndex);
  });

  it('registers /healthz after the Stripe webhook and cors()', () => {
    expect(webhookIndex).toBeGreaterThanOrEqual(0);
    expect(corsIndex).toBeGreaterThanOrEqual(0);
    expect(webhookIndex).toBeLessThan(healthzIndex);
    expect(corsIndex).toBeLessThan(healthzIndex);
  });

  it('pings the DB through the shared pool and returns a fixed body', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bpool\b[^}]*\}\s*from\s*['"]\.\/db['"]/);

    // The handler body: from the /healthz registration to the next app.use/app.get.
    const rest = source.slice(healthzIndex + 1);
    const nextReg = rest.search(/\napp\.(use|get|post)\(/);
    const handler = nextReg >= 0 ? rest.slice(0, nextReg) : rest;

    expect(handler).toMatch(/pool\.query\(\s*['"`]SELECT 1['"`]/);
    expect(handler).toMatch(/\{\s*ok:\s*true\s*\}/);
    expect(handler).toMatch(/status\(503\)\.json\(\{\s*ok:\s*false\s*\}\)/);
    // No error details, versions or stack traces in the response.
    expect(handler).not.toMatch(/json\([^)]*(error|err|message|stack|version|commit)/i);
  });

  it('is not under /api (company gate and Origin guard do not apply)', () => {
    expect(source).not.toMatch(/['"`]\/api\/healthz['"`]/);
  });
});
