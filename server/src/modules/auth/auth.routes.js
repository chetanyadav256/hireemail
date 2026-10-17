import { Router } from 'express';
import { HttpError } from '../../middleware/errors.js';
import {
  clearSessionCookie,
  requireAuthenticatedSession,
  requireSameOriginAndCsrf,
  writeSessionCookie,
} from './auth.middleware.js';
import { createAuthService } from './auth.service.js';
import { loginRequestSchema, parseAuthRequest, registerRequestSchema } from './auth.validation.js';

const RATE_WINDOW_MS = 15 * 60 * 1000;

function rateLimit(service, route, maxAttempts, clock) {
  return async (req, _res, next) => {
    await service.checkRateLimit({
      route,
      ip: req.ip,
      now: clock(),
      maxAttempts,
      windowMs: RATE_WINDOW_MS,
    });
    return next();
  };
}

function asUserId(value) {
  return String(value?._id ?? value);
}

export function createAuthRouter({
  appOrigin,
  production = false,
  repository,
  clock = () => new Date(),
  hashPassword,
  verifyPassword,
}) {
  const router = Router();
  const service = createAuthService({ repository, clock, hashPassword, verifyPassword });

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/csrf', rateLimit(service, 'csrf', 30, clock), async (req, res) => {
    const result = await service.issueCsrfToken(req.authSession);
    if (!req.authSession) {
      writeSessionCookie(res, result.session, production, clock());
    }
    res.json({ data: { csrfToken: result.csrfToken } });
  });

  router.post(
    '/register',
    rateLimit(service, 'register', 5, clock),
    requireSameOriginAndCsrf({ appOrigin }),
    async (req, res) => {
      const input = parseAuthRequest(registerRequestSchema, req.body);
      await service.register(input);
      res.status(201).json({
        data: {
          message: 'If the account can be created, registration was successful. You can now sign in.',
        },
      });
    },
  );

  router.post(
    '/login',
    rateLimit(service, 'login', 10, clock),
    requireSameOriginAndCsrf({ appOrigin }),
    async (req, res) => {
      const input = parseAuthRequest(loginRequestSchema, req.body);
      await service.checkRateLimit({
        route: 'login-account',
        ip: input.email,
        now: clock(),
        maxAttempts: 10,
        windowMs: RATE_WINDOW_MS,
      });
      const result = await service.login({
        ...input,
        currentSession: req.authSession,
      });
      writeSessionCookie(res, result.session, production, clock());
      res.json({ data: { user: result.user } });
    },
  );

  router.post(
    '/logout',
    rateLimit(service, 'logout', 30, clock),
    requireSameOriginAndCsrf({ appOrigin, allowMissingSession: true }),
    async (req, res) => {
      await service.revokeCurrentSession(req.authSession);
      clearSessionCookie(res, production);
      res.status(204).end();
    },
  );

  router.get(
    '/me',
    rateLimit(service, 'me', 120, clock),
    requireAuthenticatedSession,
    async (req, res) => {
      const user = await service.currentUser(asUserId(req.authSession.userId));
      if (!user) {
        await service.deleteSessionForCookie(req.authSession);
        clearSessionCookie(res, production);
        throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
      }
      res.json({ data: { user } });
    },
  );
  return router;
}
