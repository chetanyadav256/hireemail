import { Router } from 'express';
import { HttpError } from '../../middleware/errors.js';

export function live(req, res) {
  res.set('Cache-Control', 'no-store').json({
    data: { status: 'ok', service: 'hirereach-api' },
  });
}

export function createHealthRouter(checkDatabase) {
  const router = Router();
  router.get('/', live);
  router.get('/live', live);
  router.get('/ready', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!(await checkDatabase())) {
      throw new HttpError(503, 'NOT_READY', 'The service is not ready.');
    }
    live(req, res);
  });
  return router;
}
