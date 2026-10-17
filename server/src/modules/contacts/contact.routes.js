import { Router } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import {
  contactEditSchema,
  contactQuerySchema,
  mappingSchema,
  pageQuerySchema,
  rowQuerySchema,
  versionSchema,
} from '@hirereach/contracts';
import { requireAuthenticatedSession, requireSameOriginAndCsrf } from '../auth/auth.middleware.js';
import { HttpError } from '../../middleware/errors.js';
import { createContactService } from './contact.service.js';
import { createContactRepository } from './contact.repository.js';

function input(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      'Check the supplied fields.',
      result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  return result.data;
}
function identifier(value) {
  if (!/^[a-f\d]{24}$/i.test(value))
    throw new HttpError(404, 'NOT_FOUND', 'This resource does not exist.');
  return value;
}
function paginated(res, result, query) {
  res.json({
    data: result.items,
    meta: {
      total: result.total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(result.total / query.limit),
    },
  });
}

export function createContactRouter({
  appOrigin,
  authRepository,
  repository = createContactRepository(),
  parser,
}) {
  const router = Router();
  const service = createContactService({ repository, parser });
  const csrf = requireSameOriginAndCsrf({ appOrigin });
  let activeUploads = 0;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1, headerPairs: 50 },
    fileFilter(_req, file, done) {
      const mimeTypes = [
        'text/csv',
        'text/plain',
        'application/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/octet-stream',
      ];
      if (
        !['.csv', '.xlsx', '.xls'].includes(extname(file.originalname).toLowerCase()) ||
        !mimeTypes.includes(file.mimetype)
      )
        return done(new HttpError(415, 'UNSUPPORTED_FILE', 'Upload a CSV, XLSX or XLS file.'));
      done(null, true);
    },
  }).single('file');
  router.use(requireAuthenticatedSession, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    req.ownerId = String(req.authSession.userId);
    if (!(await authRepository.findUserById(req.ownerId)))
      throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    const window = Math.floor(Date.now() / 60000);
    const count = await authRepository.consumeRateLimit(
      `contacts:requests:${req.ownerId}:${window}`,
      new Date((window + 2) * 60000),
    );
    if (count > 120) {
      const error = new HttpError(
        429,
        'RATE_LIMITED',
        'Too many contact requests. Try again shortly.',
      );
      error.retryAfter = 60;
      throw error;
    }
    next();
  });
  router.get('/contacts', async (req, res) => {
    const query = input(contactQuerySchema, req.query);
    paginated(res, await service.list(req.ownerId, query), query);
  });
  router.get('/contacts/statistics', async (req, res) =>
    res.json({ data: await service.statistics(req.ownerId) }),
  );
  router.patch('/contacts/:id', csrf, async (req, res) =>
    res.json({
      data: await service.edit(
        req.ownerId,
        identifier(req.params.id),
        input(contactEditSchema, req.body),
      ),
    }),
  );
  router.delete('/contacts/:id', csrf, async (req, res) => {
    await service.remove(
      req.ownerId,
      identifier(req.params.id),
      input(versionSchema, req.body).expectedVersion,
    );
    res.status(204).end();
  });
  router.post('/contact-imports', csrf, async (req, res, next) => {
    const window = Math.floor(Date.now() / 3600000);
    const count = await authRepository.consumeRateLimit(
      `contacts:uploads:${req.ownerId}:${window}`,
      new Date((window + 2) * 3600000),
    );
    if (count > 10 || activeUploads >= 2) {
      const error = new HttpError(429, 'IMPORT_BUSY', 'Import capacity reached. Try again later.');
      error.retryAfter = count > 10 ? Math.ceil(((window + 1) * 3600000 - Date.now()) / 1000) : 60;
      throw error;
    }
    activeUploads += 1;
    // Acquire capacity before buffering multipart data; never retain raw file bytes.
    upload(req, res, async (error) => {
      try {
        if (error)
          throw error instanceof multer.MulterError
            ? new HttpError(
                error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
                'INVALID_UPLOAD',
                'Send one file of at most 5 MiB in the file field.',
              )
            : error instanceof HttpError
              ? error
              : new HttpError(400, 'INVALID_UPLOAD', 'The multipart upload is malformed.');
        if (!req.file) throw new HttpError(400, 'FILE_REQUIRED', 'Choose a file to upload.');
        res.status(201).json({ data: await service.upload(req.ownerId, req.file) });
      } catch (failure) {
        next(failure);
      } finally {
        activeUploads -= 1;
        if (req.file) req.file.buffer = null;
      }
    });
  });
  router.get('/contact-imports', async (req, res) => {
    const query = input(pageQuerySchema, req.query);
    paginated(res, await service.listImports(req.ownerId, query), query);
  });
  router.get('/contact-imports/:id', async (req, res) =>
    res.json({ data: await service.getImport(req.ownerId, identifier(req.params.id)) }),
  );
  router.post('/contact-imports/:id/preview', csrf, async (req, res) =>
    res.json({
      data: await service.preview(
        req.ownerId,
        identifier(req.params.id),
        input(mappingSchema, req.body),
      ),
    }),
  );
  router.post('/contact-imports/:id/commit', csrf, async (req, res) =>
    res.json({
      data: await service.commit(
        req.ownerId,
        identifier(req.params.id),
        input(versionSchema, req.body).expectedVersion,
      ),
    }),
  );
  router.get('/contact-imports/:id/rows', async (req, res) => {
    const query = input(rowQuerySchema, req.query);
    paginated(res, await service.rows(req.ownerId, identifier(req.params.id), query), query);
  });
  return router;
}
