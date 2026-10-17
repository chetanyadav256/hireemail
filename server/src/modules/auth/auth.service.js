import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../../middleware/errors.js';
import { createSession } from './auth.middleware.js';

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

let dummyHashPromise;

async function dummyPasswordHash() {
  dummyHashPromise ??= argon2.hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS);
  return dummyHashPromise;
}

function isDuplicateEmail(error) {
  return error?.code === 11000 && (error.keyPattern?.email === 1 || error.keyValue?.email);
}

export function publicUser(user) {
  return {
    id: String(user._id ?? user.id),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

export function createAuthService({
  repository,
  clock = () => new Date(),
  hashPassword = (password) => argon2.hash(password, ARGON2_OPTIONS),
  verifyPassword = (hash, password) => argon2.verify(hash, password),
}) {
  async function newSession(userId = null) {
    const now = clock();
    const session = createSession({
      userId,
      now,
      token: randomBytes(32).toString('base64url'),
      csrfToken: randomBytes(32).toString('base64url'),
    });
    await repository.createSession({
      tokenHash: session.tokenHash,
      userId: session.userId,
      csrfToken: session.csrfToken,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    });
    return session;
  }

  return {
    async register({ name, email, password }) {
      const passwordHash = await hashPassword(password);
      try {
        await repository.createUser({ name, email, passwordHash });
      } catch (error) {
        if (!isDuplicateEmail(error)) throw error;
      }
    },

    async login({ email, password, currentSession }) {
      const user = await repository.findUserByEmail(email);
      const hash = user?.passwordHash ?? (await dummyPasswordHash());
      const valid = await verifyPassword(hash, password);
      if (!user || !valid) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }

      if (currentSession) await repository.deleteSession(currentSession.tokenHash);
      const session = await newSession(String(user._id ?? user.id));
      return { user: publicUser(user), session };
    },

    async createPreAuthSession() {
      return newSession();
    },

    async currentUser(id) {
      const user = await repository.findUserById(id);
      return user ? publicUser(user) : null;
    },

    async revokeCurrentSession(session) {
      if (session) await repository.deleteSession(session.tokenHash);
    },

    async issueCsrfToken(session) {
      if (!session) {
        const created = await newSession();
        return { session: created, csrfToken: created.csrfToken };
      }
      return { session, csrfToken: session.csrfToken };
    },

    async checkRateLimit({ route, ip, now, maxAttempts, windowMs }) {
      const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
      const windowEnd = new Date(windowStart + windowMs);
      const ipHash = createHash('sha256').update(ip).digest('hex');
      const stableKey = `${route}:${windowStart}:${ipHash}`;
      const count = await repository.consumeRateLimit(stableKey, new Date(windowEnd.getTime() + windowMs));
      if (count > maxAttempts) {
        const retryAfter = Math.max(1, Math.ceil((windowEnd.getTime() - now.getTime()) / 1000));
        const error = new HttpError(
          429,
          'RATE_LIMITED',
          'Too many authentication attempts. Try again later.',
        );
        error.retryAfter = retryAfter;
        throw error;
      }
      return count;
    },

    async deleteSessionForCookie(session) {
      if (session) await repository.deleteSession(session.tokenHash);
    },
  };
}
