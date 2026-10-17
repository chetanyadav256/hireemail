import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/infrastructure/database.js';
import { createAuthIndexes } from '../src/infrastructure/migrations/auth-indexes.js';
import { AuthRateLimit } from '../src/modules/auth/auth-rate-limit.model.js';
import { Session } from '../src/modules/auth/session.model.js';
import { User } from '../src/modules/auth/user.model.js';

const testUri = process.env.TEST_MONGODB_URI;
const appOrigin = 'http://localhost:5173';
let connected = false;

afterEach(async () => {
  if (connected) {
    await disconnectDatabase();
    connected = false;
  }
});

it.skipIf(!testUri)(
  'persists registered users and authenticated sessions in the isolated MongoDB test database',
  async () => {
    await connectDatabase({
      MONGODB_URI: testUri,
      MONGODB_TIMEOUT_MS: 5000,
      NODE_ENV: 'test',
    });
    connected = true;
    await createAuthIndexes();
    const email = `auth-${randomUUID()}@example.test`;
    const app = createApp({ appOrigin, nodeEnv: 'test' });
    const agent = request.agent(app);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    try {
      await agent
        .post('/api/v1/auth/register')
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', csrf.body.data.csrfToken)
        .send({ name: 'Integration User', email, password: 'test-password-long-enough' })
        .expect(201);
      const stored = await User.findOne({ email }).select('+passwordHash');
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/u);

      const loginToken = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken;
      const login = await agent
        .post('/api/v1/auth/login')
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', loginToken)
        .send({ email, password: 'test-password-long-enough' })
        .expect(200);
      expect(login.body.data.user.email).toBe(email);
      expect(await Session.countDocuments({ userId: stored._id })).toBe(1);
      await agent.get('/api/v1/auth/me').expect(200);
    } finally {
      const stored = await User.findOne({ email }).select('_id');
      if (stored) {
        await Session.deleteMany({ userId: stored._id });
        await User.deleteOne({ _id: stored._id });
      }
      await AuthRateLimit.deleteMany({ key: new RegExp(`^(csrf|register|login):`) });
    }
  },
);
