import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { healthResponseSchema } from '@hirereach/contracts';
import { createApp } from '../src/app.js';

const appOrigin = 'http://localhost:5173';

describe('health and HTTP boundaries', () => {
  const app = createApp({ appOrigin, checkDatabase: async () => true });

  it.each(['/api/health', '/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready'])(
    'returns a valid health response at %s',
    async (path) => {
      const response = await request(app).get(path).expect(200);
      expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-request-id']).toBeTruthy();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    },
  );

  it('separates liveness from unavailable database readiness', async () => {
    const offlineApp = createApp({ appOrigin, checkDatabase: async () => false });
    await request(offlineApp).get('/api/v1/health/live').expect(200);
    const response = await request(offlineApp).get('/api/v1/health/ready').expect(503);
    expect(response.body.error.code).toBe('NOT_READY');
  });

  it('allows only the configured browser origin', async () => {
    const allowed = await request(app).get('/api/health').set('Origin', appOrigin).expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(appOrigin);
    const denied = await request(app)
      .get('/api/health')
      .set('Origin', 'https://untrusted.example')
      .expect(403);
    expect(denied.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns the centralized not-found contract', async () => {
    const response = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
      requestId: expect.any(String),
    });
  });

  it('rejects malformed and oversized JSON without leaking input', async () => {
    const malformed = await request(app)
      .post('/api/v1/missing')
      .set('Content-Type', 'application/json')
      .send('{"private":')
      .expect(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(malformed.body)).not.toContain('private');
    const oversized = await request(app)
      .post('/api/v1/missing')
      .send({ value: 'a'.repeat(110000) })
      .expect(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('redacts unexpected failures and correlates errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const broken = createApp({
        appOrigin,
        checkDatabase: async () => {
          throw new Error('secret-credential');
        },
      });
      const response = await request(broken).get('/api/v1/health/ready').expect(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
      expect(JSON.stringify(response.body)).not.toContain('secret-credential');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret-credential');
    } finally {
      log.mockRestore();
    }
  });
});
