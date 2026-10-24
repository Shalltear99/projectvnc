/**
 * Stream authorisation endpoint for nginx `auth_request`.
 *
 * nginx issues an internal subrequest to this path for every WebSocket
 * handshake, forwarding the original URI in X-Original-URI. The browser never
 * calls it directly and needs no session cookie here — the HMAC ticket in the
 * query string IS the credential.
 *
 * Status contract (deliberate): 200 for authorised, 401 for everything else.
 * Never 404 — nginx maps any non-2xx to a denial, and a 404 would be
 * indistinguishable from "instance unknown", which is exactly what we do not
 * want to disclose.
 */
import { Router } from 'express';
import { verifyVncToken } from '../services/vnc-token';
import { getStore } from '../db/store';
import { logger } from '../logger';
import { asyncHandler } from '../errors';

const router = Router();

/** /vnc-stream/<id>/websockify?... — ids are uuids or slugs, never slashes. */
const STREAM_PATH = /^\/vnc-stream\/([0-9a-zA-Z-]{1,64})(?:\/|$)/;

/**
 * Collapse repeated slashes before matching.
 *
 * noVNC's vnc_lite.html builds its URL as `'/' + path`, so a caller that passes
 * a path already starting with `/` produces `//vnc-stream/...`. nginx still
 * routes it (it normalises internally) but the raw `$request_uri` reaches this
 * handler verbatim, and a leading `//` would fail the anchored pattern — a 401
 * that looks exactly like a bad token. Normalise instead of blaming the client.
 */
function normalisePath(pathname: string): string {
  return pathname.replace(/\/{2,}/g, '/');
}

router.get('/authorize', asyncHandler(async (req, res) => {
  const deny = (reason: string): void => {
    logger.info({ reason, uri: req.get('x-original-uri') }, 'vnc authorize denied');
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'invalid or expired stream token' } });
  };

  const original = req.get('x-original-uri');
  if (!original) {
    deny('missing x-original-uri');
    return;
  }

  let parsed: URL;
  try {
    // The header carries a path + query, not an absolute URL; a dummy origin
    // makes the parser happy without ever being used for anything.
    parsed = new URL(original, 'http://cloudjava.internal');
  } catch {
    deny('unparseable x-original-uri');
    return;
  }

  const match = STREAM_PATH.exec(normalisePath(parsed.pathname));
  if (!match) {
    deny('path does not match the stream prefix');
    return;
  }
  const instanceId = match[1];

  const token = parsed.searchParams.get('token');
  if (!token) {
    deny('missing token');
    return;
  }

  const claims = verifyVncToken(token);
  if (!claims) {
    deny('token failed verification or expired');
    return;
  }
  if (claims.instanceId !== instanceId) {
    // A valid ticket for a different instance must not open this stream.
    deny('token/instance mismatch');
    return;
  }

  try {
    const instance = await getStore().getInstance(instanceId);
    // A ticket outlives a stop/delete by design; the row is the authority on
    // whether the container behind the port still exists.
    if (!instance || instance.userId !== claims.userId || instance.status !== 'running') {
      deny('instance not running or not owned by the token subject');
      return;
    }
  } catch (err) {
    logger.error({ err, instanceId }, 'vnc authorize store lookup failed');
    deny('authorization backend unavailable');
    return;
  }

  // Empty 200: nginx only looks at the status code, and an empty body keeps the
  // handshake path allocation-free.
  res.status(200).end();
}));

export default router;
