import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function runServer(overrides) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../src/server.js', import.meta.url))],
      {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          APP_ORIGIN: 'http://localhost:5173',
          ...overrides,
        },
        windowsHide: true,
      },
    );
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Startup did not terminate within 10 seconds'));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}

describe('startup failure behavior', () => {
  it('exits unsuccessfully for missing configuration', async () => {
    const result = await runServer({ MONGODB_URI: '' });
    expect(result.code).toBe(1);
    expect(result.output).toContain('Invalid server configuration: MONGODB_URI');
  });
  it('fails promptly and safely when MongoDB is unavailable', async () => {
    const result = await runServer({
      MONGODB_URI: 'mongodb://127.0.0.1:1/unavailable',
      MONGODB_TIMEOUT_MS: '100',
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('Database startup failed');
    expect(result.output).not.toContain('mongodb://');
  });
});
