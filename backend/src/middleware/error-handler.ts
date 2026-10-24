/**
 * Central error handling.
 *
 * Contract with clients: every failure is `{ "error": { "code", "message" } }`
 * with a stable machine-readable code. Contract with operators: the stack trace
 * goes to the log, never to the response — in production a leaked stack reveals
 * file layout, dependency versions and sometimes credentials.
 */
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger';
import { AppError } from '../errors';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function isHttpError(err: unknown): err is { status: number; code?: string; message: string } {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as { status?: unknown; statusCode?: unknown };
  const status = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
  return typeof status === 'number' && status >= 400 && status <= 599;
}

export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (res.headersSent) {
    // The response is already streaming; the only correct move is to let Express
    // destroy the socket rather than write a second set of headers.
    next(err);
    return;
  }

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'internal server error';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'request validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (isHttpError(err)) {
    status = err.status;
    code = err.code ?? (status === 404 ? 'NOT_FOUND' : 'REQUEST_ERROR');
    // body-parser / express errors have safe, generic messages.
    message = status < 500 ? err.message : 'internal server error';
  } else if (err instanceof SyntaxError && 'body' in (err as object)) {
    status = 400;
    code = 'INVALID_JSON';
    message = 'request body is not valid JSON';
  }

  if (status >= 500) {
    logger.error({ err, method: req.method, path: req.path, requestId: req.id }, 'unhandled request error');
  } else {
    logger.warn({ code, method: req.method, path: req.path, requestId: req.id }, 'request rejected');
  }

  const body: ErrorBody = { error: { code, message } };
  if (details !== undefined) body.error.details = details;

  res.status(status).json(body);
};

/** Terminal 404 for unmatched routes; shape matches the error handler. */
export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ErrorBody = {
    error: { code: 'NOT_FOUND', message: `no route for ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};
