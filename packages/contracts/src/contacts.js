import { z } from 'zod';

export const contactFields = ['email', 'hrName', 'companyName', 'designation'];
const optionalText = z
  .string()
  .trim()
  .max(200)
  .refine(
    (value) =>
      ![...value].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ),
    'Control characters are not allowed',
  );
export const contactInputSchema = z
  .object({
    email: z.string().trim().max(254).email(),
    hrName: optionalText.default(''),
    companyName: optionalText.default(''),
    designation: optionalText.default(''),
  })
  .strict();
export const contactEditSchema = contactInputSchema.extend({
  expectedVersion: z.number().int().min(0),
  archived: z.boolean().optional(),
});
export const versionSchema = z.object({ expectedVersion: z.number().int().min(0) }).strict();
export const mappingSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    sheet: z.string().min(1).max(100),
    mapping: z
      .object(
        Object.fromEntries(
          contactFields.map((key) => [key, z.number().int().min(0).max(49).nullable()]),
        ),
      )
      .strict(),
  })
  .strict()
  .refine((value) => value.mapping.email !== null, {
    message: 'Map an email column.',
    path: ['mapping', 'email'],
  });

export const contactQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(2000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(100).default(''),
    status: z.enum(['active', 'archived', 'all']).default('active'),
    company: z.string().trim().max(200).default(''),
    importId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
  })
  .strict();
export const pageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(2000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const rowQuerySchema = pageQuerySchema.extend({
  status: z.enum(['all', 'valid', 'invalid', 'duplicate', 'skipped']).default('all'),
});
