/**
 * Authentication routes (docs/prd.md FR-1.1/FR-1.2).
 *
 * Passwords are bcrypt-hashed with cost 12. Login answers "invalid credentials"
 * for every failure mode — unknown email, wrong password, suspended account —
 * because a precise error turns the endpoint into an account oracle.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { asyncHandler } from '../errors';
import { getStore } from '../db/store';
import { AppError } from '../errors';
import { requireAuth, issueSessionToken, sessionCookieOptions, SESSION_COOKIE } from '../middleware/auth';
import { loginLimiter } from '../middleware/rate-limit';
import type { User } from '../types';

const router = Router();

const BCRYPT_ROUNDS = 12;

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // 10 is the floor mandated by the task; bcrypt truncates at 72 bytes, so cap
  // there rather than silently ignoring the tail of a long passphrase.
  password: z.string().min(10, 'password must be at least 10 characters').max(72),
});

/**
 * Compared against when the email is unknown, so a login attempt costs the same
 * whether or not the account exists (no timing-based user enumeration).
 */
const DUMMY_HASH = bcrypt.hashSync('cloudjava-dummy-password', BCRYPT_ROUNDS);

function publicUser(user: User): { id: string; email: string; role: User['role']; createdAt: string } {
  // Explicit allow-list: passwordHash must never be reachable from a response.
  return { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
}

router.post(
  '/register',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = credentialsSchema.parse(req.body);
    const store = getStore();

    const existing = await store.findUserByEmail(body.email);
    if (existing) {
      // Registration inevitably reveals whether an email is taken; the rate
      // limiter is what keeps that from becoming an enumeration tool.
      throw new AppError(409, 'EMAIL_TAKEN', 'email is already registered');
    }

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    const user = await store.createUser({ email: body.email, passwordHash, role: 'user' });

    res.cookie(SESSION_COOKIE, issueSessionToken(user), sessionCookieOptions());
    res.status(201).json({ user: publicUser(user) });
  }),
);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = credentialsSchema.parse(req.body);
    const store = getStore();
    const user = await store.findUserByEmail(body.email);

    const matches = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !matches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'invalid credentials');
    }
    if (user.suspendedAt) {
      // Same message and status as a wrong password: suspension is an
      // administrative state, not something an attacker should be able to probe.
      throw new AppError(401, 'INVALID_CREDENTIALS', 'invalid credentials');
    }

    res.cookie(SESSION_COOKIE, issueSessionToken(user), sessionCookieOptions());
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    // Clear with the same attributes used to set it, otherwise the browser keeps
    // the original cookie (path/domain mismatch leaves a live session behind).
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.status(204).end();
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'authentication required');
    res.json({ user: publicUser(req.user) });
  }),
);

export default router;
