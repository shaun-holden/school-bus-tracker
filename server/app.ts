import express, { type Express, type Request, Response, NextFunction } from "express";
import cors from "cors";
import type http from "http";
import { registerRoutes } from "./routes";
import { log } from "./vite";
import { WebhookHandlers } from './webhookHandlers';
import { isCrossSiteWriteBlocked } from './authGate';
import { pool } from "./db";
import { ALLOWED_ORIGINS } from './origins';
import { isDbQueryError, pgError } from './dbErrors';

// Builds the Express app with every middleware and route in production order,
// without seeding, without the client (dev or static) handlers, and without
// listening. server/index.ts adds those; the integration harness uses this
// directly. Registration order here is load-bearing (raw-body webhook first,
// then the CORS layer, the Origin guard, the health check, the JSON body
// parser, the logger and the API routes) and is guarded by
// tests/webhook-ordering.test.ts and tests/healthz.test.ts.
export async function createApp(
  opts?: { requestLog?: boolean },
): Promise<{ app: Express; server: http.Server }> {
  const app = express();

  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const signature = req.headers['stripe-signature'];

      if (!signature) {
        return res.status(400).json({ error: 'Missing stripe-signature' });
      }

      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;

        if (!Buffer.isBuffer(req.body)) {
          console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
          return res.status(500).json({ error: 'Webhook processing error' });
        }

        await WebhookHandlers.processWebhook(req.body as Buffer, sig);

        res.status(200).json({ received: true });
      } catch (error: any) {
        console.error('Webhook error:', error.message);
        res.status(400).json({ error: 'Webhook processing error' });
      }
    }
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin and non-browser requests omit the Origin header — always allow.
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
    })
  );

  // HF3 / SEC-18: reject cross-site writes to /api. The production session
  // cookie is SameSite=None, so a foreign page could otherwise POST with it.
  // Non-GET/HEAD/OPTIONS /api requests carrying an Origin must come from
  // ALLOWED_ORIGINS or from this server's own host; `Origin: null` is blocked.
  // No Origin header (non-browser / native clients) is allowed. Registered after
  // the Stripe webhook (which carries no browser Origin) and after cors().
  // The decision is in server/authGate.ts and matches /api case-insensitively.
  app.use((req, res, next) => {
    const selfOrigin = `${req.protocol}://${req.get('host')}`;
    if (isCrossSiteWriteBlocked(req.method, req.path, req.get('origin'), selfOrigin, ALLOWED_ORIGINS)) {
      return res.status(403).json({ message: 'Cross-site request blocked' });
    }
    next();
  });

  // Public DB health check. Registered before registerRoutes() and the SPA
  // catch-all so it can't be shadowed, and outside /api so the company gate and
  // the Origin guard don't apply. Fixed body only: no version, commit or error
  // details are ever returned.
  app.get('/healthz', async (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Health check timed out after 3000ms')), 3000);
        }),
      ]);
      res.status(200).json({ ok: true });
    } catch (error: any) {
      console.error('Health check failed:', error?.message ?? String(error));
      res.status(503).json({ ok: false });
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  // JSON bodies only. express.urlencoded was removed (HF3 / SEC-18) so plain
  // cross-site HTML form posts can no longer feed string fields to handlers.
  app.use(express.json());

  if (opts?.requestLog !== false) {
    app.use((req, res, next) => {
      const start = Date.now();
      const path = req.path;
      let capturedJsonResponse: Record<string, any> | undefined = undefined;

      const originalResJson = res.json;
      res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
      };

      res.on("finish", () => {
        const duration = Date.now() - start;
        if (path.startsWith("/api")) {
          let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
          if (capturedJsonResponse) {
            logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
          }

          if (logLine.length > 80) {
            logLine = logLine.slice(0, 79) + "…";
          }

          log(logLine);
        }
      });

      next();
    });
  }

  const server = await registerRoutes(app);

  // Unmatched /api/* paths return JSON 404 instead of falling through to the
  // SPA catch-all (which would serve index.html with a 200). Registered after
  // every real API route but before the dev/static client handlers, which
  // server/index.ts adds after createApp() returns.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ message: 'Not found' });
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    // A drizzle-wrapped DB error's message carries SQL + params: never send
    // or log it. Log only the Postgres error code.
    if (isDbQueryError(err)) {
      console.error("Database error", pgError(err)?.code);
      return res.status(500).json({ message: "Internal Server Error" });
    }

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error('Unhandled error:', err);
    res.status(status).json({ message });
  });

  return { app, server };
}
