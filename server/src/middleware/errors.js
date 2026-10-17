export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function notFound(req, res, next) {
  next(new HttpError(404, 'NOT_FOUND', 'The requested endpoint does not exist.'));
}

// Express recognizes error handlers by all four parameters.
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  let safeError = error;
  if (error.type === 'entity.parse.failed') {
    safeError = new HttpError(400, 'INVALID_JSON', 'The request body must contain valid JSON.');
  } else if (error.type === 'entity.too.large') {
    safeError = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request body exceeds the size limit.');
  } else if (error.status === 415 && !(error instanceof HttpError)) {
    safeError = new HttpError(
      415,
      'UNSUPPORTED_ENCODING',
      'The request encoding is not supported.',
    );
  }

  const known = safeError instanceof HttpError;
  if (!known) {
    console.error(JSON.stringify({ event: 'request_failed', requestId: req.requestId }));
  }
  if (known && safeError.retryAfter) res.set('Retry-After', String(safeError.retryAfter));
  res.status(known ? safeError.status : 500).json({
    error: {
      code: known ? safeError.code : 'INTERNAL_ERROR',
      message: known ? safeError.message : 'An unexpected error occurred.',
      ...(known && safeError.fields ? { fields: safeError.fields } : {}),
    },
    requestId: req.requestId,
  });
}
