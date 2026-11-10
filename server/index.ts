import "dotenv/config";
import fs from "fs";
import path from "path";
import { createApp } from "./app";
import { setupVite, serveStatic, log } from "./vite";
import { seedMasterAdmin } from '../scripts/seed-master-admin';

// Re-exported for compatibility; the list lives in ./origins.
export { ALLOWED_ORIGINS } from './origins';

(async () => {
  await seedMasterAdmin().catch(err => console.error('Master admin seed error:', err));

  // Middleware, routes, the /api 404 and the error handler, in production order.
  const { app, server } = await createApp();

  // Use Vite in development, static files in production.
  // Check NODE_ENV first, but also verify built files exist as a fallback.
  // This handles Replit deployment containers that may not set NODE_ENV reliably.
  const builtClientPath = path.resolve(process.cwd(), "dist", "public", "index.html");
  const builtFilesExist = fs.existsSync(builtClientPath);
  const isDev = process.env.NODE_ENV === "development" || !builtFilesExist;

  if (isDev) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });
})();
