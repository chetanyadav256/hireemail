import { HttpError } from '../../middleware/errors.js';
import { loginRequestSchema, registerRequestSchema } from '@hirereach/contracts';

export { loginRequestSchema, registerRequestSchema };

export function parseAuthRequest(schema, body) {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'VALIDATION_ERROR',
    'Please correct the highlighted fields.',
    result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  );
}
