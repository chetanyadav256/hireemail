import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { isDatabaseReady } from './infrastructure/database.js';
import { errorHandler, HttpError, notFound } from './middleware/errors.js';
import { createSessionMiddleware } from './modules/auth/auth.middleware.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createAuthRepository } from './modules/auth/auth.repository.js';
import { createHealthRouter, live } from './modules/health/health.routes.js';
import { createContactRouter } from './modules/contacts/contact.routes.js';

export function createApp({
  appOrigin,
  nodeEnv = process.env.NODE_ENV,
  checkDatabase = isDatabaseReady,
  authOptions = {},
  contactOptions = {},
}) {
  const app = express();
  const authRepository = authOptions.repository ?? createAuthRepository();
  const contactRouter = createContactRouter({ appOrigin, authRepository, ...contactOptions });
  const authConfig = {
    appOrigin,
    production: nodeEnv === 'production',
    ...authOptions,
    repository: authRepository,
  };
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-Id', req.requestId);
    next();
  });
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === appOrigin) return callback(null, true);
        callback(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed.'));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/v1', createSessionMiddleware(authConfig));
  app.get('/api/health', live);
  app.use('/api/v1/health', createHealthRouter(checkDatabase));
  app.use('/api/v1/auth', createAuthRouter(authConfig));
  app.use('/api/v1', (req, res, next) => {
    if (!/^\/(contacts|contact-imports)(\/|$)/.test(req.path)) return next();
    return contactRouter(req, res, next);
  });
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
