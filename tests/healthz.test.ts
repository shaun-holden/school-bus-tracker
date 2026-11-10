import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// `/healthz` is registered by `createApp()` in `server/app.ts`; `server/index.ts`
// then adds the Vite/static SPA handlers and listens. Importing either file
// would load routes/storage and need a database (see
// tests/webhook-ordering.test.ts), so this reads the sources as text and
// asserts registration order. A real HTTP test of GET /healthz (200 with a DB,
// 503 without) comes with the Q4 HTTP/DB harness.
//
// Invariants under guard:
// - /healthz is registered before registerRoutes(app), and createApp() (which
//   registers it) runs before the Vite/static SPA setup in index.ts, so the SPA
//   catch-all can never shadow it (a shadowed health check would return
//   index.html with a 200 and Railway would mark a broken deploy healthy).
// - It pings the database through the shared `pool` from server/db.ts.
// - Its body is fixed ({ ok: true } / { ok: false }) and never carries
//   error details.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('server/app.ts /healthz', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../server/app.ts'),
    'utf-8',
  );

  const healthzIndex = source.search(/app\.get\(\s*['"`]\/healthz['"`]/);
  const registerRoutesIndex = source.indexOf('registerRoutes(app)');
  const webhookIndex = source.search(/['"`]\/api\/stripe\/webhook['"`]/);
  const corsIndex = source.indexOf('cors(');

  it('registers GET /healthz before registerRoutes(app)', () => {
    expect(healthzIndex).toBeGreaterThanOrEqual(0);
    expect(registerRoutesIndex).toBeGreaterThanOrEqual(0);

    expect(healthzIndex).toBeLessThan(registerRoutesIndex);
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
    const nextReg = rest.search(/\n\s*app\.(use|get|post)\(/);
    const handler = nextReg >= 0 ? rest.slice(0, nextReg) : rest;

    expect(handler).toMatch(/pool\.query\(\s*['"`]SELECT 1['"`]/);
    expect(handler).toMatch(/\{\s*ok:\s*true\s*\}/);
    expect(handler).toMatch(/status\(503\)\.json\(\{\s*ok:\s*false\s*\}\)/);
    // No error details, versions or stack traces in the response.
    expect(handler).not.toMatch(/json\([^)]*(error|err|message|stack|version|commit)/i);
  });

  // Structural status-code / header facts only. Timeout length and timer
  // cleanup are behaviour and need the Q4 HTTP harness (or an exported handler).
  function healthzHandlerSource(): string {
    const rest = source.slice(healthzIndex + 1);
    const nextReg = rest.search(/\n\s*app\.(use|get|post)\(/);
    return nextReg >= 0 ? rest.slice(0, nextReg) : rest;
  }

  it('sets Cache-Control: no-store so probes and proxies never cache a result', () => {
    expect(healthzHandlerSource()).toMatch(
      /res\.set\(\s*['"`]Cache-Control['"`]\s*,\s*['"`]no-store['"`]\s*\)/,
    );
  });

  it('answers 200 only from the try block and 503 is the only status in catch', () => {
    const handler = healthzHandlerSource();
    const catchIndex = handler.search(/\}\s*catch\s*\(/);
    const finallyIndex = handler.search(/\}\s*finally\s*\{/);
    expect(catchIndex).toBeGreaterThanOrEqual(0);
    expect(finallyIndex).toBeGreaterThan(catchIndex);

    const tryPart = handler.slice(0, catchIndex);
    const catchPart = handler.slice(catchIndex, finallyIndex);
    const finallyPart = handler.slice(finallyIndex);

    expect(tryPart.match(/status\(\s*200\s*\)/g) ?? []).toHaveLength(1);
    // A DB error or timeout must never report healthy.
    expect(catchPart.match(/status\(\s*\d+\s*\)/g)).toEqual(['status(503)']);
    expect(catchPart).not.toMatch(/ok:\s*true/);
    expect(finallyPart).not.toMatch(/\bres\.|status\(/);
  });

  it('is not under /api (company gate and Origin guard do not apply)', () => {
    expect(source).not.toMatch(/['"`]\/api\/healthz['"`]/);
  });

  it('never sets up the Vite/static SPA handlers itself', () => {
    expect(source).not.toMatch(/setupVite/);
    expect(source).not.toMatch(/serveStatic/);
  });
});

describe('server/index.ts SPA setup comes after createApp()', () => {
  const indexSource = fs.readFileSync(
    path.resolve(__dirname, '../server/index.ts'),
    'utf-8',
  );

  const createAppIndex = indexSource.indexOf('createApp(');
  const setupViteIndex = indexSource.indexOf('setupVite(');
  const serveStaticIndex = indexSource.indexOf('serveStatic(');

  it('calls setupVite( and serveStatic( only after createApp(', () => {
    expect(createAppIndex).toBeGreaterThanOrEqual(0);
    expect(setupViteIndex).toBeGreaterThanOrEqual(0);
    expect(serveStaticIndex).toBeGreaterThanOrEqual(0);

    expect(createAppIndex).toBeLessThan(setupViteIndex);
    expect(createAppIndex).toBeLessThan(serveStaticIndex);
  });
});
