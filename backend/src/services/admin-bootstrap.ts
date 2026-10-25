/**
 * Admin bootstrap.
 *
 * Why an env-driven seed and not an endpoint: an HTTP route that grants the
 * admin role is a privilege-escalation hole the moment it is reachable, and a
 * hardcoded admin credential in the repo is worse. Seeding from the environment
 * at boot keeps the capability off the network entirely, works for both store
 * drivers, and is idempotent — restarting the API does not duplicate or reset
 * anything.
 *
 * Deliberately conservative:
 *   - does nothing when ADMIN_EMAIL is unset (the normal case for a plain
 *     `npm start`, and for every test run)
 *   - refuses to create an account with a weak password instead of silently
 *     accepting it
 *   - never logs the password
 *   - promotes an existing account rather than failing, so a user who already
 *     signed up with that email ends up with the intended role
 *   - never demotes anyone: clearing the env var does not strip privileges,
 *     because that would be an easy way to lock yourself out by accident
 */
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { getStore } from '../db/store';
import { logger } from '../logger';

/** bcrypt truncates at 72 bytes; 12 is the floor for a seeded credential. */
const MIN_PASSWORD_LENGTH = 12;

export interface AdminBootstrapResult {
  action: 'skipped' | 'created' | 'promoted' | 'already-admin';
  email?: string;
}

export async function ensureAdminUser(): Promise<AdminBootstrapResult> {
  const email = config.admin.email;
  const password = config.admin.password;

  if (!email) {
    return { action: 'skipped' };
  }

  if (!password) {
    logger.warn(
      { email },
      'ADMIN_EMAIL is set but ADMIN_PASSWORD is missing — no admin account was created',
    );
    return { action: 'skipped', email };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (got ${password.length})`,
    );
  }

  const store = getStore();
  const existing = await store.findUserByEmail(email);

  if (existing) {
    if (existing.role === 'admin') {
      logger.info({ email }, 'admin bootstrap: account already has the admin role');
      return { action: 'already-admin', email };
    }
    const promoted = await store.updateUserRole(existing.id, 'admin');
    logger.warn({ email, userId: promoted?.id }, 'admin bootstrap: existing account promoted to admin');
    return { action: 'promoted', email };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await store.createUser({ email, passwordHash, role: 'admin' });
  // Never log the password or the hash.
  logger.info({ email: user.email, userId: user.id }, 'admin bootstrap: admin account created');
  return { action: 'created', email: user.email };
}
