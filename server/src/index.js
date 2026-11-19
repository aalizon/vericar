import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { getConfig, getPublicConfig } from './config.js';
import { initDb, closeDb, checkDbHealth } from './db/index.js';
import { bootstrapAdminSync } from './services/authService.js';
import { handleStripeWebhook } from './services/billingService.js';
import {
  securityHeadersMiddleware,
  createCorsMiddleware,
  requestLoggerMiddleware,
  jsonErrorGuard,
  apiNotFoundHandler,
  centralErrorHandler,
  asyncHandler,
} from './middleware/security.js';
import { createDefaultLimiters } from './middleware/rateLimit.js';
import { attachUser, csrfOriginCheck } from './middleware/auth.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createBillingRoutes } from './routes/billingRoutes.js';
import { createReportRoutes } from './routes/reportRoutes.js';
import { createAdminRoutes } from './routes/adminRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(options = {}) {
  const {
    configOverrides = {},
    rateLimitOverrides = {},
    fetchImpl = globalThis.fetch,
    skipDbInit = false,
  } = options;

  const cfg = getConfig(configOverrides);
  if (!skipDbInit) {
    initDb(cfg.dbPath);
    bootstrapAdminSync(configOverrides);
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);

  const limiters = createDefaultLimiters({ configOverrides, rateLimitOverrides });

  app.use(securityHeadersMiddleware(configOverrides));
  app.use(createCorsMiddleware(configOverrides));
  app.use(requestLoggerMiddleware(configOverrides));

  // Stripe webhook MUST receive raw body BEFORE express.json()
  app.post(
    '/api/billing/stripe/webhook',
    express.raw({ type: 'application/json', limit: '512kb' }),
    asyncHandler(async (req, res) => {
      const sigHeader = req.headers['stripe-signature'];
      const result = handleStripeWebhook(req.body, sigHeader, configOverrides);
      res.status(200).json(result);
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(jsonErrorGuard);

  // Health & readiness probes (exempt from rate limits & CSRF)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'VériCar Europe API',
      version: cfg.appVersion || '2.0.0',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    });
  });

  app.get('/api/ready', (_req, res) => {
    const health = checkDbHealth();
    if (!health.ok) {
      return res.status(503).json({
        status: 'not_ready',
        db: 'error',
        error: health.error,
        timestamp: new Date().toISOString(),
      });
    }
    res.json({
      status: 'ready',
      db: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/config/public', (_req, res) => {
    res.json(getPublicConfig(configOverrides));
  });

  // Session attachment, general rate limit & CSRF protection for /api
  app.use('/api', limiters.general);
  app.use('/api', attachUser);
  app.use('/api', csrfOriginCheck(configOverrides));

  // Mount feature routers
  app.use('/api', createAuthRoutes({ limiters, configOverrides }));
  app.use('/api', createBillingRoutes({ limiters, configOverrides, fetchImpl }));
  app.use('/api', createReportRoutes({ limiters, configOverrides, fetchImpl }));
  app.use('/api', createAdminRoutes({ configOverrides }));

  // Strict JSON 404 for unknown /api/* routes
  app.use('/api', apiNotFoundHandler);

  // Serve compiled Vite frontend in production if built
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(
      express.static(clientDist, {
        maxAge: '7d',
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(centralErrorHandler);

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const cfg = getConfig();
  const app = createApp();
  const server = app.listen(cfg.port, cfg.host || '0.0.0.0', () => {
    console.log(`VériCar Europe SaaS actif sur http://${cfg.host || '0.0.0.0'}:${cfg.port} (billing=${cfg.billing.billingMode})`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Arrêt propre (${signal})…`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => {
      closeDb();
      process.exit(1);
    }, 8000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
