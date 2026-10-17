import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashSessionToken } from '../src/modules/auth/auth.middleware.js';

const appOrigin = 'http://localhost:5173';
const owner = '111111111111111111111111';
const other = '222222222222222222222222';
const id = '333333333333333333333333';
const cookie = `hirereach.sid=${'a'.repeat(43)}`;
function fixture() {
  const authRepository = {
    findSession: async (hash) =>
      hash === hashSessionToken('a'.repeat(43))
        ? {
            tokenHash: hash,
            userId: other,
            csrfToken: 'csrf-token',
            expiresAt: new Date(Date.now() + 60000),
            absoluteExpiresAt: new Date(Date.now() + 600000),
          }
        : null,
    updateSession: async () => {},
    findUserById: async () => ({ _id: other }),
    consumeRateLimit: async () => 1,
  };
  const repository = {
    findImport: vi.fn(async (userId) => (userId === owner ? { _id: id } : null)),
    findContact: vi.fn(async (userId) => (userId === owner ? { _id: id } : null)),
    listContacts: vi.fn(async () => ({ items: [], total: 0 })),
    transaction: async (_userId, work) => work(repository),
  };
  return {
    repository,
    authRepository,
    app: createApp({
      appOrigin,
      authOptions: { repository: authRepository },
      contactOptions: { repository },
    }),
  };
}
describe('contact authorization boundaries', () => {
  it.each([
    ['get', '/contacts'],
    ['get', '/contacts/statistics'],
    ['get', '/contact-imports'],
    ['get', `/contact-imports/${id}`],
    ['get', `/contact-imports/${id}/rows`],
    ['post', '/contact-imports'],
    ['post', `/contact-imports/${id}/preview`],
    ['post', `/contact-imports/${id}/commit`],
    ['patch', `/contacts/${id}`],
    ['delete', `/contacts/${id}`],
  ])('rejects unauthenticated %s %s', async (method, path) => {
    await request(fixture().app)[method](`/api/v1${path}`).expect(401);
  });
  it('checks CSRF before processing upload data', async () => {
    await request(fixture().app)
      .post('/api/v1/contact-imports')
      .set('Cookie', cookie)
      .set('Origin', appOrigin)
      .attach('file', Buffer.from('Email\na@example.com'), 'a.csv')
      .expect(403);
  });
  it('hides another owner’s import, preview, commit, rows, edit and deletion', async () => {
    const { app, repository } = fixture();
    for (const path of [`/contact-imports/${id}`, `/contact-imports/${id}/rows`])
      await request(app).get(`/api/v1${path}`).set('Cookie', cookie).expect(404);
    for (const [method, path, body] of [
      [
        'post',
        `/contact-imports/${id}/preview`,
        {
          expectedVersion: 0,
          sheet: 'CSV',
          mapping: { email: 0, hrName: null, companyName: null, designation: null },
        },
      ],
      ['post', `/contact-imports/${id}/commit`, { expectedVersion: 0 }],
      ['patch', `/contacts/${id}`, { expectedVersion: 0, email: 'a@example.com' }],
      ['delete', `/contacts/${id}`, { expectedVersion: 0 }],
    ]) {
      const apiRequest = request(app);
      await apiRequest[method](`/api/v1${path}`)
        .set('Cookie', cookie)
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', 'csrf-token')
        .send(body)
        .expect(404);
    }
    expect(repository.findImport).toHaveBeenCalledWith(other, id);
    expect(repository.findContact).toHaveBeenCalledWith(other, id);
  });
  it('rejects ownership injection and invalid pagination', async () => {
    const { app } = fixture();
    await request(app).get(`/api/v1/contacts?userId=${owner}`).set('Cookie', cookie).expect(422);
    await request(app).get('/api/v1/contacts?limit=10000').set('Cookie', cookie).expect(422);
    await request(app)
      .patch(`/api/v1/contacts/${id}`)
      .set('Cookie', cookie)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', 'csrf-token')
      .send({ expectedVersion: 0, email: 'a@example.com', userId: owner })
      .expect(422);
  });
  it('rejects oversized files and unexpected fields before persistence', async () => {
    const { app } = fixture();
    await request(app)
      .post('/api/v1/contact-imports')
      .set('Cookie', cookie)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', 'csrf-token')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1, 65), 'a.csv')
      .expect(413);
    await request(app)
      .post('/api/v1/contact-imports')
      .set('Cookie', cookie)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', 'csrf-token')
      .attach('file', Buffer.from('bad'), 'a.exe')
      .expect(415);
    await request(app)
      .post('/api/v1/contact-imports')
      .set('Cookie', cookie)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', 'csrf-token')
      .field('userId', owner)
      .attach('file', Buffer.from('Email\na@example.com'), 'a.csv')
      .expect(400);
    const malformed = await request(app)
      .post('/api/v1/contact-imports')
      .set('Cookie', cookie)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', 'csrf-token')
      .set('Content-Type', 'multipart/form-data; boundary=broken')
      .send('--broken\r\n')
      .expect(400);
    expect(malformed.body.error.code).toBe('INVALID_UPLOAD');
  });
  it('applies durable request and upload limits before persistence', async () => {
    const { app, authRepository, repository } = fixture();
    authRepository.consumeRateLimit = async () => 121;
    await request(app)
      .get('/api/v1/contacts')
      .set('Cookie', cookie)
      .expect(429)
      .expect('Retry-After', '60');
    expect(repository.listContacts).not.toHaveBeenCalled();
    authRepository.consumeRateLimit = async (key) => (key.startsWith('contacts:uploads:') ? 11 : 1);
    await request(app)
      .post('/api/v1/contact-imports')
      .set('Cookie', cookie)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', 'csrf-token')
      .attach('file', Buffer.from('Email\na@example.com'), 'a.csv')
      .expect(429);
  });
});
