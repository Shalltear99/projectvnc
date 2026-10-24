/**
 * Session authentication.
 *
 * The JWT lives in an httpOnly cookie so page JavaScript (and therefore any XSS
 * payload) cannot read it; the Authorization header is accepted as well for
 * non-browser clients. Both paths verify the same secret and then re-load the
 * user from the store — a token proves who logged in, not that the account is
 * still allowed in (suspension must take effect immediately).
 */
import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { getStore } from '../db/store';
import { AppError } from '../errors';
import type { User } from '../types';

export const SESSION_COOKIE = 'cj_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by requireAuth / requireAdmin. Never serialised directly. */
      user?: User;
    }
  }
}

interface SessionClaims {
  sub: string;
  role: User['role'];
}

export function issueSessionToken(user: User): string {
  const claims: SessionClaims = { sub: user.id, role: user.role };
  return jwt.sign(claims, config.auth.jwtSecret, {
    // jsonwebtoken types want its own StringValue union; config keeps the raw
    // env string so operators can use any of the accepted formats ("7d", "12h").
    expiresIn: config.auth.jwtExpiresIn as SignOptions['expiresIn'],
    issuer: 'cloudjava',
  });
}

export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    // lax, not strict: the dashboard is same-site, but the payment gateway
    // redirects back with a top-level GET and strict would drop the session.
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  const cookieToken = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken) return cookieToken;
  return null;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'authentication required');

    let claims: SessionClaims;
    try {
      claims = jwt.verify(token, config.auth.jwtSecret, { issuer: 'cloudjava' }) as SessionClaims;
    } catch {
      // Expired and forged tokens get the same answer: do not help an attacker
      // distinguish "valid signature, expired" from "garbage".
      throw new AppError(401, 'UNAUTHENTICATED', 'session is invalid or expired');
    }
    if (!claims.sub) throw new AppError(401, 'UNAUTHENTICATED', 'session is invalid or expired');

    const user = await getStore().findUserById(claims.sub);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'session is invalid or expired');
    if (user.suspendedAt) throw new AppError(403, 'ACCOUNT_SUSPENDED', 'account is suspended');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (req.user?.role !== 'admin') {
      next(new AppError(403, 'FORBIDDEN', 'administrator role required'));
      return;
    }
    next();
  });
}
