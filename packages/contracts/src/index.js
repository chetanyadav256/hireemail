import { z } from 'zod';
export * from './contacts.js';

const normalizedEmailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((value) => value.toLowerCase());

const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127));

export const registerRequestSchema = z
  .object({
    name: displayNameSchema,
    email: normalizedEmailSchema,
    password: z.string().min(12).max(128),
  })
  .strict();

export const loginRequestSchema = z
  .object({
    email: normalizedEmailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export const authUserSchema = z
  .object({
    id: z.string().min(1),
    name: displayNameSchema,
    email: normalizedEmailSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export const authUserResponseSchema = z.object({
  data: z.object({ user: authUserSchema }),
});

export const registerResponseSchema = z.object({
  data: z.object({ message: z.string() }),
});

export const csrfResponseSchema = z.object({
  data: z.object({ csrfToken: z.string().min(32) }),
});

export const healthResponseSchema = z.object({
  data: z.object({
    status: z.literal('ok'),
    service: z.literal('hirereach-api'),
  }),
});
