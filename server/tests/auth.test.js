import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { createApp } from '../src/app.js';

const appOrigin = 'http://localhost:5173';
const password = 'a-long-test-passphrase';

function createMemoryRepository() {
  const users = new Map();
  const sessions = new Map();
  const rateLimits = new Map();

  return {
    users,
    sessions,
    async createUser(fields) {
      if ([...users.values()].some((user) => user.email === fields.email)) {
        const duplicate = new Error('duplicate');
        duplicate.code = 11000;
        duplicate.keyPattern = { email: 1 };
        throw duplicate;
      }
      const user = { _id: randomUUID(), ...fields, createdAt: new Date() };
      users.set(user._id, user);
      return { ...user };
    },
    async findUserByEmail(email) {
      const user = [...users.values()].find((item) => item.email === email);
      return user ? { ...user } : null;
    },
    async findUserById(id) {
      const user = users.get(String(id));
      return user ? { ...user } : null;
    },
    async createSession(session) {
      sessions.set(session.tokenHash, { ...session });
      return { ...session };
    },
    async findSession(tokenHash) {
      const session = sessions.get(tokenHash);
      return session ? { ...session } : null;
    },
    async updateSession(tokenHash, fields) {
      const session = sessions.get(tokenHash);
      if (!session) return null;
      Object.assign(session, fields);
      return { ...session };
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async consumeRateLimit(key) {
      const count = (rateLimits.get(key) ?? 0) + 1;
      rateLimits.set(key, count);
      return count;
    },
  };
}

let repository;
let now;
let app;

beforeEach(() => {
  repository = createMemoryRepository();
  now = new Date('2026-01-01T00:00:00.000Z');
  app = createApp({
    appOrigin,
    nodeEnv: 'test',
    authOptions: { repository, clock: () => new Date(now) },
  });
});

async function tokenFor(agent) {
  const response = await agent.get('/api/v1/auth/csrf').expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  return response.body.data.csrfToken;
}

async function register(agent, overrides = {}, expectedStatus = 201) {
  const token = await tokenFor(agent);
  return agent
    .post('/api/v1/auth/register')
    .set('Origin', appOrigin)
    .set('X-CSRF-Token', token)
    .send({
      name: 'Taylor Example',
      email: 'taylor@example.test',
      password,
      ...overrides,
    })
    .expect(expectedStatus);
}

async function login(agent, email = 'taylor@example.test', pass = password, expectedStatus = 200) {
  const token = await tokenFor(agent);
  return agent
    .post('/api/v1/auth/login')
    .set('Origin', appOrigin)
    .set('X-CSRF-Token', token)
    .send({ email, password: pass })
    .expect(expectedStatus);
}

describe('authentication API', () => {
  it('registers users with an Argon2id hash and returns no credential material', async () => {
    const agent = request.agent(app);
    const response = await register(agent);
    expect(response.body.data.message).toContain('You can now sign in.');
    expect(repository.users.size).toBe(1);
    const user = [...repository.users.values()][0];
    expect(user.passwordHash).toMatch(/^\$argon2id\$/u);
    expect(JSON.stringify(response.body)).not.toContain(user.passwordHash);
    expect(response.body.data.user).toBeUndefined();
    expect(await argon2.verify(user.passwordHash, password)).toBe(true);
  });

  it('normalizes email and handles duplicate registration with the same generic response', async () => {
    const first = request.agent(app);
    const duplicate = request.agent(app);
    const created = await register(first, { email: 'Taylor@Example.Test' });
    const repeated = await register(duplicate, { email: 'taylor@example.test' });
    expect(repeated.body).toEqual(created.body);
    expect(repository.users.size).toBe(1);
  });

  it('rejects weak passwords and invalid registration fields', async () => {
    const agent = request.agent(app);
    const response = await register(
      agent,
      { name: ' ', email: 'not-an-email', password: 'short' },
      400,
    );
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fields.map(({ field }) => field)).toEqual(
      expect.arrayContaining(['name', 'email', 'password']),
    );
    expect(repository.users.size).toBe(0);
  });

  it('logs in and exposes only the safe profile', async () => {
    const agent = request.agent(app);
    await register(agent);
    const response = await login(agent);
    expect(response.body.data.user).toMatchObject({
      name: 'Taylor Example',
      email: 'taylor@example.test',
    });
    expect(response.body.data.user.id).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|argon2/u);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(response.headers['set-cookie'][0]).toContain('Path=/');
    expect(repository.sessions.size).toBe(1);
    await agent.get('/api/v1/auth/me').expect(200, { data: { user: response.body.data.user } });
  });

  it('uses a generic error for unknown users and incorrect passwords', async () => {
    const agent = request.agent(app);
    await register(agent);
    const wrongPassword = await login(
      agent,
      'taylor@example.test',
      'incorrect-passphrase',
      401,
    );
    const unknownEmail = await login(agent, 'nobody@example.test', password, 401);
    expect(wrongPassword.body.error).toEqual(unknownEmail.body.error);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('denies unauthenticated access and expires idle sessions in application code', async () => {
    const agent = request.agent(app);
    await agent.get('/api/v1/auth/me').expect(401);
    await register(agent);
    await login(agent);
    now = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const expired = await agent.get('/api/v1/auth/me').expect(401);
    expect(expired.headers['x-session-expired']).toBe('true');
    expect(repository.sessions.size).toBe(0);
  });

  it('enforces the seven-day absolute session limit despite session activity', async () => {
    const agent = request.agent(app);
    await register(agent);
    await login(agent);
    for (let day = 1; day <= 6; day += 1) {
      now = new Date(now.getTime() + 23 * 60 * 60 * 1000);
      await agent.get('/api/v1/auth/me').expect(200);
    }
    now = new Date('2026-01-08T00:00:00.000Z');
    const expired = await agent.get('/api/v1/auth/me').expect(401);
    expect(expired.headers['x-session-expired']).toBe('true');
  });

  it('revokes only the current session on logout and clears its cookie', async () => {
    const first = request.agent(app);
    const second = request.agent(app);
    await register(first);
    await login(first);
    await register(second, { email: 'other@example.test' });
    await login(second, 'other@example.test');
    const firstProfile = await first.get('/api/v1/auth/me').expect(200);
    const secondProfile = await second.get('/api/v1/auth/me').expect(200);
    const token = await tokenFor(first);
    const logout = await first
      .post('/api/v1/auth/logout')
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', token)
      .send({ userId: secondProfile.body.data.user.id })
      .expect(204);
    expect(
      logout.headers['set-cookie'].some((cookie) => cookie.includes('Expires=Thu, 01 Jan 1970')),
    ).toBe(true);
    await first.get('/api/v1/auth/me').expect(401);
    await second.get('/api/v1/auth/me').expect(200, secondProfile.body);
    expect(firstProfile.body.data.user.id).not.toBe(secondProfile.body.data.user.id);
  });

  it('rejects missing CSRF tokens and untrusted origins', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', appOrigin)
      .send({ name: 'Taylor Example', email: 'taylor@example.test', password })
      .expect(403)
      .then((response) => expect(response.body.error.code).toBe('CSRF_INVALID'));

    const token = await tokenFor(agent);
    const response = await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'https://attacker.example')
      .set('X-CSRF-Token', token)
      .send({ name: 'Taylor Example', email: 'taylor@example.test', password })
      .expect(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(repository.users.size).toBe(0);
  });

  it('binds CSRF tokens to the issuing session and ignores client-selected user IDs', async () => {
    const owner = request.agent(app);
    const other = request.agent(app);
    await register(owner, { email: 'owner@example.test' });
    await login(owner, 'owner@example.test');
    await register(other, { email: 'other@example.test' });
    await login(other, 'other@example.test');
    const ownerToken = await tokenFor(owner);
    const response = await other
      .post('/api/v1/auth/logout')
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', ownerToken)
      .expect(403);
    expect(response.body.error.code).toBe('CSRF_INVALID');
    const otherProfile = await other.get('/api/v1/auth/me').expect(200);
    const ownerProfile = await owner.get('/api/v1/auth/me').expect(200);
    const userIdOverride = await other
      .get('/api/v1/auth/me')
      .query({ userId: ownerProfile.body.data.user.id })
      .expect(200);
    expect(userIdOverride.body.data.user.id).toBe(otherProfile.body.data.user.id);
  });

  it('persists rate-limit buckets and returns a retry interval', async () => {
    const agent = request.agent(app);
    for (let index = 0; index < 5; index += 1) {
      await register(agent, { email: `user${index}@example.test` });
    }
    const response = await register(agent, { email: 'sixth@example.test' }, 429);
    expect(response.headers['retry-after']).toBeTruthy();
    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(repository.users.size).toBe(5);
  });

  it('uses Secure __Host cookies in production', async () => {
    const productionApp = createApp({
      appOrigin: 'https://app.example.test',
      nodeEnv: 'production',
      authOptions: { repository: createMemoryRepository() },
    });
    const response = await request(productionApp).get('/api/v1/auth/csrf').expect(200);
    expect(response.headers['set-cookie'][0]).toContain('__Host-hirereach.sid=');
    expect(response.headers['set-cookie'][0]).toContain('Secure');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
  });
});
