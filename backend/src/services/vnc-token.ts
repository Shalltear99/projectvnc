/**
 * Short-lived, HMAC-signed VNC connection tokens.
 *
 * WHY: the browser must never receive the container's RFB password. The proxy
 * layer (nginx auth_request / websockify handshake) validates this token
 * instead, so a leaked URL is useless after `vncTokenTtlSeconds` and is bound
 * to a single (instanceId, userId) pair — one user's token cannot be replayed
 * against another user's stream, nor against a different instance.
 *
 * Token format: `v1.<base64url(payload)>.<base64url(hmac-sha256)>`
 * The payload is signed, not encrypted: it only contains identifiers that the
 * caller already knows, and nothing secret.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export interface VncTokenClaims {
  instanceId: string;
  userId: string;
}

export interface SignedVncToken extends VncTokenClaims {
  token: string;
  /** ISO-8601 instant after which verifyVncToken() rejects the token. */
  expiresAt: string;
}

interface TokenPayload {
  /** instance id */
  i: string;
  /** user id */
  u: string;
  /** expiry, epoch seconds */
  exp: number;
}

const VERSION = 'v1';

function hmac(input: string): Buffer {
  return createHmac('sha256', config.auth.vncTokenSecret).update(input).digest();
}

function encodePayload(payload: TokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(encoded: string): TokenPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<TokenPayload>;
    if (typeof candidate.i !== 'string' || !candidate.i) return null;
    if (typeof candidate.u !== 'string' || !candidate.u) return null;
    if (typeof candidate.exp !== 'number' || !Number.isFinite(candidate.exp)) return null;
    return { i: candidate.i, u: candidate.u, exp: candidate.exp };
  } catch {
    // A malformed base64/JSON payload is indistinguishable from a forged one.
    return null;
  }
}

/**
 * Mint a token for one instance and one user. The caller must already have
 * proven that `userId` owns `instanceId`.
 */
export function signVncToken(instanceId: string, userId: string): SignedVncToken {
  if (!instanceId || !userId) {
    throw new Error('signVncToken requires both instanceId and userId');
  }
  const expiresAtMs = Date.now() + config.auth.vncTokenTtlSeconds * 1000;
  const payload: TokenPayload = {
    i: instanceId,
    u: userId,
    exp: Math.floor(expiresAtMs / 1000),
  };
  const body = `${VERSION}.${encodePayload(payload)}`;
  const token = `${body}.${hmac(body).toString('base64url')}`;
  return {
    instanceId,
    userId,
    token,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

/**
 * Validate a token. Returns the claims only when the signature matches
 * byte-for-byte AND the token has not expired; every other case returns null so
 * callers cannot accidentally treat "expired" as "valid".
 */
export function verifyVncToken(token: string): VncTokenClaims | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [version, encoded, signature] = parts;
  if (version !== VERSION) return null;

  const expected = hmac(`${version}.${encoded}`);
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  // Length must match before timingSafeEqual (it throws on unequal lengths),
  // and a length mismatch is itself a rejection: no partial-tag comparison.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  const payload = decodePayload(encoded);
  if (!payload) return null;
  if (payload.exp * 1000 <= Date.now()) return null;

  return { instanceId: payload.i, userId: payload.u };
}
