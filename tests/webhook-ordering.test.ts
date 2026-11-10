import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The middleware stack is built by `createApp()` in `server/app.ts`, which
// `server/index.ts` calls before adding the client handlers and listening.
// Importing either file would load routes/storage and need a database, so we
// read the source as text and assert the middleware registration order by
// string index — a zero-side-effect check.
//
// The invariant under guard: the Stripe raw-body webhook handler
// (`app.post('/api/stripe/webhook', express.raw(...))`) must be registered
// BEFORE the `cors` layer, which must be registered BEFORE `express.json()`.
// Stripe signature verification needs the UNPARSED raw request body; if
// `express.json()` (or any body parser CORS may front) runs first, `req.body`
// is no longer a Buffer and signature verification silently breaks. A future
// reordering of these three lines would compile fine and pass every other
// test, so this source-order guard exists to fail loudly the moment the order
// is disturbed.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('server/app.ts middleware ordering', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../server/app.ts'),
    'utf-8',
  );

  // Tolerant matching so a formatter reflow (whitespace / newlines) does not
  // break the test: a regex for the webhook route, plain substring finds for
  // the two body-layer tokens.
  const webhookIndex = source.search(/['"`]\/api\/stripe\/webhook['"`]/);
  const corsIndex = source.indexOf('cors(');
  const jsonIndex = source.indexOf('express.json()');

  it('registers the raw-body webhook handler before cors, and cors before express.json()', () => {
    // Fail loudly if any landmark was renamed/removed rather than silently
    // passing on a `-1 < -1` comparison.
    expect(webhookIndex).toBeGreaterThanOrEqual(0);
    expect(corsIndex).toBeGreaterThanOrEqual(0);
    expect(jsonIndex).toBeGreaterThanOrEqual(0);

    // The invariant: raw webhook handler -> cors -> express.json().
    // Raw body must be captured before CORS/body-parsing middleware runs, or
    // `req.body` is no longer the Buffer Stripe signature verification needs.
    expect(webhookIndex).toBeLessThan(corsIndex);
    expect(corsIndex).toBeLessThan(jsonIndex);
  });

  // HF3 / SEC-18: the cross-site write guard must sit after the Stripe webhook
  // (which carries no browser Origin and must keep its raw body) and after
  // cors(), and the urlencoded body parser must stay removed so cross-site
  // HTML form posts cannot feed string fields to /api handlers.
  it('registers the Origin guard after the webhook and after cors(), and has no express.urlencoded', () => {
    const originGuardIndex = source.indexOf('isCrossSiteWriteBlocked(req.method');
    expect(originGuardIndex).toBeGreaterThanOrEqual(0);
    expect(webhookIndex).toBeLessThan(originGuardIndex);
    expect(corsIndex).toBeLessThan(originGuardIndex);
    expect(source).not.toMatch(/express\.urlencoded\s*\(/);
  });
});

describe('server/index.ts registers no middleware of its own', () => {
  const indexSource = fs.readFileSync(
    path.resolve(__dirname, '../server/index.ts'),
    'utf-8',
  );

  // Everything order-sensitive lives in createApp(). A body parser or a
  // second webhook route added in index.ts would bypass the guards above.
  it('has no express.urlencoded and no Stripe webhook route', () => {
    expect(indexSource).not.toMatch(/express\.urlencoded\s*\(/);
    expect(indexSource).not.toMatch(/['"`]\/api\/stripe\/webhook['"`]/);
  });
});
