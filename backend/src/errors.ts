/**
 * Error primitives shared by routes, middleware and services.
 *
 * Every error that is allowed to reach a client carries an HTTP status and a
 * stable machine-readable `code`, so the frontend can branch on the code while
 * the message stays human-readable. Anything else becomes a 500 and its text is
 * never echoed back (docs/security.md — no internal detail leaks).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    // Keeps `instanceof` working when the class is transpiled to ES5 targets.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const httpError = (status: number, code: string, message: string, details?: unknown): AppError =>
  new AppError(status, code, message, details);

export const notFoundError = (what = 'resource'): AppError =>
  new AppError(404, 'NOT_FOUND', `${what} not found`);

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, 'BAD_REQUEST', message, details);

/**
 * Express 4 does not await handlers, so a rejected promise would become an
 * unhandled rejection and the request would hang until the client times out.
 * Every async handler is wrapped so failures land in the error middleware.
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler => {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
};
