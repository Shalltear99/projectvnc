#!/usr/bin/env node
/**
 * JanitorAgent — standalone worker-node cleanup daemon (docs/agents.md §5,
 * docs/tasks.md Task 2.3).
 *
 * Runs alongside the API process, not instead of it: the API's JanitorAgent
 * sweeps through the Store, this daemon sweeps straight through the Docker
 * socket. Both are idempotent, so they may overlap — a container one of them
 * already removed simply looks like a 404 to the other.
 *
 * Deliberate differences from the spec skeleton:
 *   * orphan sweep for managed containers no reaper could ever expire;
 *   * per-container try/catch, so one broken container cannot abort the sweep;
 *   * SIGTERM/SIGINT handling that finishes the current sweep before exiting;
 *   * refuses to run against DOCKER_DRIVER=mock (it would silently do nothing);
 *   * stale /tmp/.X11-unix lock sweep for Xvfb/TigerVNC left by crashed containers.
 *
 * Usage:
 *   node agent-daemon.js            # loop every JANITOR_INTERVAL_MS (default 60s)
 *   node agent-daemon.js --once     # single sweep, exit (cron / systemd timer)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Docker = require('dockerode');

const LABEL_MANAGED = 'cloudjava.managed';
const LABEL_INSTANCE = 'cloudjava.instance_id';
const LABEL_EXPIRES = 'cloudjava.expires_at';

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const POLL_INTERVAL_MS = Number.parseInt(process.env.JANITOR_INTERVAL_MS || '60000', 10);
const X11_LOCK_DIR = process.env.X11_LOCK_DIR || '/tmp/.X11-unix';
const ONCE = process.argv.includes('--once');

let stopping = false;
let sweeps = 0;
let timer = null;

function log(level, message, meta) {
  const stamp = new Date().toISOString();
  const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const line = `[${stamp}] [JanitorAgent] [${level}] ${message}${suffix}`;
  if (level === 'ERROR' || level === 'WARN') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/**
 * The API refuses to boot with DOCKER_DRIVER=mock in production; the daemon has
 * no config loader, so it honours the same variable directly. Unset means "real
 * Docker": a worker node has no reason to run the mock driver.
 */
function assertNotMockDriver() {
  const driver = (process.env.DOCKER_DRIVER || 'docker').toLowerCase();
  if (driver === 'mock') {
    log('ERROR', 'DOCKER_DRIVER=mock — this daemon only makes sense against a real Docker socket; refusing to run');
    process.exit(78); // EX_CONFIG, same convention as the API
  }
}

function dockerClient() {
  return new Docker({ socketPath: DOCKER_SOCKET, timeout: 15000 });
}

function parseEpoch(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function stopAndRemove(docker, containerId) {
  const container = docker.getContainer(containerId);
  try {
    await container.stop({ t: 10 });
  } catch (err) {
    // 304 = already stopped, 404 = already gone. Both mean "carry on".
    if (err && err.statusCode !== 304 && err.statusCode !== 404) throw err;
  }
  try {
    await container.remove({ force: true, v: true });
  } catch (err) {
    if (err && err.statusCode !== 404) throw err;
  }
}

/** Containers whose subscription epoch has passed (docs/agents.md §2.3.1). */
async function sweepExpired(docker, now) {
  let reaped = 0;
  const containers = await docker.listContainers({ all: true });

  for (const info of containers) {
    const labels = info.Labels || {};
    if (labels[LABEL_MANAGED] !== 'true') continue;

    const instanceId = labels[LABEL_INSTANCE] || '(unlabelled)';
    const expiresAt = parseEpoch(labels[LABEL_EXPIRES]);
    if (expiresAt === null) continue; // handled by the orphan sweep
    if (now <= expiresAt) continue;

    try {
      log('INFO', `instance ${instanceId} expired (${new Date(expiresAt).toISOString()}) — reaping`, {
        containerId: info.Id.slice(0, 12),
      });
      await stopAndRemove(docker, info.Id);
      reaped += 1;
      log('INFO', `purged instance ${instanceId}`);
    } catch (err) {
      // A single unreapable container must not abort the sweep.
      log('ERROR', `failed to reap instance ${instanceId}`, { error: err.message });
    }
  }
  return reaped;
}

/**
 * Managed containers that no reaper can ever expire: missing instance id, or a
 * missing/unparseable expires_at label. They are invisible to the Store and to
 * the expiry sweep, so they would hold ports and disk forever.
 */
async function sweepOrphans(docker) {
  let removed = 0;
  const containers = await docker.listContainers({ all: true });

  for (const info of containers) {
    const labels = info.Labels || {};
    if (labels[LABEL_MANAGED] !== 'true') continue;

    const hasInstance = Boolean(labels[LABEL_INSTANCE]);
    const hasExpiry = parseEpoch(labels[LABEL_EXPIRES]) !== null;
    if (hasInstance && hasExpiry) continue;

    const reason = !hasInstance ? 'missing instance_id label' : 'missing or invalid expires_at label';
    try {
      log('WARN', `orphan managed container (${reason}) — removing`, { containerId: info.Id.slice(0, 12) });
      await stopAndRemove(docker, info.Id);
      removed += 1;
    } catch (err) {
      log('ERROR', 'failed to remove orphan container', { containerId: info.Id.slice(0, 12), error: err.message });
    }
  }
  return removed;
}

/**
 * Xvfb/TigerVNC leave /tmp/.X11-unix/X<n>-lock behind when a container is killed.
 * A lock whose PID no longer exists is safe to delete; one whose PID is alive is
 * left strictly alone (it may belong to a healthy container or to the host).
 */
async function sweepX11Locks() {
  let removed = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(X11_LOCK_DIR);
  } catch (err) {
    if (err.code !== 'ENOENT') log('WARN', `cannot read ${X11_LOCK_DIR}`, { error: err.message });
    return 0;
  }

  for (const entry of entries) {
    if (!/^X\d+-lock$/.test(entry)) continue;
    const lockPath = path.join(X11_LOCK_DIR, entry);
    try {
      const raw = (await fs.promises.readFile(lockPath, 'utf8')).trim();
      const pid = Number.parseInt(raw, 10);
      const alive = Number.isInteger(pid) && pid > 0 && fs.existsSync(`/proc/${pid}`);
      if (alive) continue;
      await fs.promises.unlink(lockPath);
      removed += 1;
      log('INFO', `removed stale X11 lock ${entry} (pid ${Number.isNaN(pid) ? '?' : pid} is gone)`);
    } catch (err) {
      // EACCES/EPERM: not our file, someone else's display. Skip quietly.
      if (err.code !== 'ENOENT' && err.code !== 'EACCES' && err.code !== 'EPERM') {
        log('WARN', `failed to inspect ${entry}`, { error: err.message });
      }
    }
  }
  return removed;
}

async function runOnce() {
  const started = Date.now();
  const now = Date.now();
  log('INFO', 'starting container audit');

  const docker = dockerClient();
  let reaped = 0;
  let orphans = 0;
  let locks = 0;

  try {
    // Fail fast (and once) if the socket is unreachable, instead of three
    // separate timeouts inside the individual sweeps.
    await docker.ping();
  } catch (err) {
    log('ERROR', `cannot reach the Docker socket at ${DOCKER_SOCKET}: ${err.message}`);
    return { ok: false, reaped, orphans, locks, error: err.message, durationMs: Date.now() - started };
  }

  try {
    reaped = await sweepExpired(docker, now);
  } catch (err) {
    log('ERROR', 'expiry sweep failed', { error: err.message });
  }
  try {
    orphans = await sweepOrphans(docker);
  } catch (err) {
    log('ERROR', 'orphan sweep failed', { error: err.message });
  }
  try {
    locks = await sweepX11Locks();
  } catch (err) {
    log('ERROR', 'X11 lock sweep failed', { error: err.message });
  }

  const durationMs = Date.now() - started;
  sweeps += 1;
  log('INFO', 'audit complete', { reaped, orphans, x11Locks: locks, durationMs });
  return { ok: true, reaped, orphans, locks, durationMs };
}

function scheduleNext() {
  if (stopping) return;
  timer = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      // runOnce is defensive already; this is the last line of defence so a bug
      // can never kill the daemon.
      log('ERROR', 'unexpected sweep failure', { error: err.message });
    }
    scheduleNext();
  }, POLL_INTERVAL_MS);
  // Do not hold the event loop open just for the timer: SIGTERM must exit.
  timer.unref();
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log('INFO', `${signal} received — finishing current sweep and exiting`, { sweeps });
  if (timer) clearTimeout(timer);
  // The process exits on its own once the in-flight sweep resolves; the timeout
  // is the guarantee that a hung Docker call cannot keep us alive forever.
  setTimeout(() => process.exit(0), 5000).unref();
}

async function main() {
  assertNotMockDriver();
  log('INFO', `janitor starting`, { mode: ONCE ? 'once' : 'loop', intervalMs: POLL_INTERVAL_MS, socket: DOCKER_SOCKET });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  if (ONCE) {
    const summary = await runOnce();
    // Exit 0 even when the socket is unreachable in --once mode: cron should not
    // page on a worker where Docker is simply not installed. The log carries it.
    log('INFO', 'single sweep finished', { ok: summary.ok, reaped: summary.reaped, orphans: summary.orphans });
    process.exit(0);
  }

  await runOnce();
  scheduleNext();
}

main().catch((err) => {
  log('ERROR', 'fatal', { error: err.message });
  process.exit(1);
});
