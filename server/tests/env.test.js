import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../src/config/env.js';

const valid = {
  APP_ORIGIN: 'http://localhost:5173',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/test?replicaSet=rs0',
};

describe('server configuration', () => {
  it('applies safe development defaults', () => {
    expect(parseEnvironment(valid)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 5000,
      MONGODB_TIMEOUT_MS: 5000,
    });
  });
  it.each([
    { PORT: 'bad' },
    { PORT: '0' },
    { MONGODB_URI: '' },
    { APP_ORIGIN: 'http://localhost:5173/path' },
    { MONGODB_TIMEOUT_MS: '0' },
    { NODE_ENV: 'production' },
  ])('rejects invalid configuration: %j', (override) => {
    expect(() => parseEnvironment({ ...valid, ...override })).toThrow(
      'Invalid server configuration',
    );
  });
  it('never prints a rejected secret value', () => {
    expect(() => parseEnvironment({ ...valid, MONGODB_URI: 'secret-value' })).toThrow(
      'MONGODB_URI',
    );
    try {
      parseEnvironment({ ...valid, MONGODB_URI: 'secret-value' });
    } catch (error) {
      expect(error.message).not.toContain('secret-value');
    }
  });
});
