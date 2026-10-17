import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../middleware/errors.js';

export const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const PREAUTH_SESSION_MS = 30 * 60 * 1000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionCookieName(production) {
  return production ? '__Host-hirereach.sid' : 'hirereach.sid';
}

function setSessionCookie(res, token, expiresAt, now, production) {
  res.cookie(sessionCookieName(production), token, {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
  });
}

export function clearSessionCookie(res, production) {
  res.clearCookie(sessionCookieName(production), {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
  });
}

function readSessionCookie(req, production) {
  const name = `${sessionCookieName(production)}=`;
  const pair = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(name));
  const token = pair?.slice(name.length);
  return token && SESSION_ID_PATTERN.test(token) ? token : null;
}

export function createSessionMiddleware({ repository, production = false, clock = () => new Date() }) {
  return async (req, res, next) => {
    const token = readSessionCookie(req, production);
    if (!token) return next();

    const tokenHash = hashSessionToken(token);
    const session = await repository.findSession(tokenHash);
    if (!session) {
      clearSessionCookie(res, production);
      return next();
    }

    const now = clock();
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
      await repository.deleteSession(tokenHash);
      res.set('X-Session-Expired', 'true');
      clearSessionCookie(res, production);
      return next();
    }

    if (session.userId) {
      const expiresAt = new Date(
        Math.min(now.getTime() + SESSION_IDLE_MS, session.absoluteExpiresAt.getTime()),
      );
      await repository.updateSession(tokenHash, { expiresAt, lastSeenAt: now });
      setSessionCookie(res, token, expiresAt, now, production);
      session.expiresAt = expiresAt;
      session.lastSeenAt = now;
    }

    req.authSession = { ...session, tokenHash };
    return next();
  };
}

export function requireAuthenticatedSession(req, _res, next) {
  if (!req.authSession?.userId) {
    return next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
  }
  return next();
}

export function requireSameOriginAndCsrf({ appOrigin, allowMissingSession = false }) {
  return (req, _res, next) => {
    if (req.get('Origin') !== appOrigin) {
      return next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'This request origin is not allowed.'));
    }

    const session = req.authSession;
    if (!session && allowMissingSession) return next();

    const supplied = req.get('X-CSRF-Token');
    const expected = session?.csrfToken;
    if (typeof supplied !== 'string' || typeof expected !== 'string') {
      return next(new HttpError(403, 'CSRF_INVALID', 'The request could not be verified.'));
    }
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    if (
      suppliedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(suppliedBytes, expectedBytes)
    ) {
      return next(new HttpError(403, 'CSRF_INVALID', 'The request could not be verified.'));
    }
    return next();
  };
}

export function createSession({ userId = null, now, token, csrfToken }) {
  const preauth = userId === null;
  const absoluteExpiresAt = new Date(
    now.getTime() + (preauth ? PREAUTH_SESSION_MS : SESSION_ABSOLUTE_MS),
  );
  return {
    token,
    tokenHash: hashSessionToken(token),
    userId,
    csrfToken,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: preauth
      ? absoluteExpiresAt
      : new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absoluteExpiresAt.getTime())),
    absoluteExpiresAt,
  };
}

export function writeSessionCookie(res, session, production, now) {
  setSessionCookie(res, session.token, session.expiresAt, now, production);
}
