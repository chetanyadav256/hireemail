import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['server/tests/**/*.test.js'], environment: 'node', testTimeout: 15000 },
});
