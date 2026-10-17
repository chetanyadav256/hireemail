import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    HOST: z.enum(['127.0.0.1', '0.0.0.0', '::1']).default('127.0.0.1'),
    APP_ORIGIN: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
      }, 'Must be an HTTP(S) origin without a path or trailing slash'),
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\/\S+$/),
    MONGODB_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && !env.APP_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'HTTPS required in production',
      });
    }
  });

export function parseEnvironment(source) {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    // Report field names only: configuration values may contain credentials.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(
      `Invalid server configuration: ${fields.join(', ')}. Check server/.env.example.`,
    );
  }
  return result.data;
}

export function loadEnvironment() {
  if (process.env.NODE_ENV !== 'test') {
    dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
  }
  return parseEnvironment(process.env);
}
