#!/usr/bin/env node
/**
 * TC-01: Container Lifecycle (docs/testing.md §1.1)
 *
 * Spawns a real API process against the in-memory store, the mock Docker driver
 * and the noop proxy router, then drives the whole lifecycle over HTTP exactly
 * as the dashboard would: register -> login -> order -> settle -> provision ->
 * connect -> stop -> start -> restart -> delete -> re-provision.
 *
 * The proof this produces is behavioural, not structural: it asserts the
 * instance reaches `running` in under 5s (docs/prd.md §7), that ports land in
 * their documented ranges, that the VNC ticket authorises the stream path at the
 * nginx auth endpoint and that a tampered ticket does not.
 *
 * Run: node scripts/integration-test.mjs
 * Exit code 0 = every step passed.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');
const PORT = Number(process.env.TEST_PORT || 4010);
const BASE = `http://127.0.0.1:${PORT}`;
const PROVISION_BUDGET_MS = 5000;

const results = [];
let fatal = false;
let child = null;
let serverLog = '';
let cookie = '';

// ── tiny assertion / reporting helpers ────────────────────────────────────────
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
}

async function step(name, fn) {
  if (fatal) {
    record(name, null, 'skipped');
    return undefined;
  }
  const started = Date.now();
  try {
    const detail = await fn();
    record(name, true, `${detail ?? 'ok'} (${Date.now() - started}ms)`);
    return detail;
  } catch (err) {
    fatal = true;
    record(name, false, err.message);
    return undefined;
  }
}

function printTable() {
  const nameWidth = Math.max(...results.map((r) => r.name.length), 6);
  const cellWidth = 62; // verdict (5) + detail
  const detailWidth = cellWidth - 5;
  const line = (l, m, r) => `${l}${'─'.repeat(nameWidth + 2)}${m}${'─'.repeat(cellWidth + 2)}${r}`;
  const out = [];
  out.push('');
  out.push(line('┌', '┬', '┐'));
  out.push(`│ ${'STEP'.padEnd(nameWidth)} │ ${'RESULT'.padEnd(cellWidth)} │`);
  out.push(line('├', '┼', '┤'));
  for (const r of results) {
    const verdict = r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'SKIP';
    const detail = String(r.detail).slice(0, detailWidth).padEnd(detailWidth);
    out.push(`│ ${r.name.padEnd(nameWidth)} │ ${verdict} ${detail} │`);
  }
  out.push(line('└', '┴', '┘'));
  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  out.push(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

// ── HTTP client ───────────────────────────────────────────────────────────────
async function api(method, route, options = {}) {
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (cookie && options.auth !== false) headers.cookie = cookie;

  const res = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(15000),
  });

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const [pair] = c.split(';');
    if (pair.startsWith('cj_session=')) cookie = pair;
  }

  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt';
  while (Date.now() < deadline) {
    try {
      const res = await api('GET', '/api/admin/health', { auth: false });
      if (res.status === 200) return res.json;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await sleep(150);
  }
  throw new Error(`API did not become healthy: ${lastError}`);
}

// ── server lifecycle ──────────────────────────────────────────────────────────
function startServer() {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(PORT),
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    DATABASE_DRIVER: 'memory',
    DOCKER_DRIVER: 'mock',
    PROXY_MODE: 'noop',
    PAYMENT_PROVIDER: 'mock',
    ENABLE_AGENTS: 'true',
    JWT_SECRET: 'integration-test-jwt-secret-32-chars-min',
    VNC_TOKEN_SECRET: 'integration-test-vnc-token-secret-32-chars',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    // Fast loops so the test does not wait a minute for a janitor sweep.
    METRICS_INTERVAL_MS: '1000',
    JANITOR_INTERVAL_MS: '60000',
  };
  delete env.REDIS_URL; // force the in-process event bus

  child = spawn(process.execPath, [path.join(BACKEND, 'dist', 'index.js')], {
    cwd: BACKEND,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => {
    serverLog += d.toString();
  });
  child.stderr.on('data', (d) => {
    serverLog += d.toString();
  });
  child.on('exit', (code, signal) => {
    serverLog += `\n[server exited code=${code} signal=${signal}]\n`;
  });
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 8000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
  if (child.exitCode === null) child.kill('SIGKILL');
}

// ── the test ──────────────────────────────────────────────────────────────────
async function main() {
  startServer();
  const health = await waitForHealth();
  assert(health.drivers?.store === 'memory', 'expected the memory store driver');
  assert(health.drivers?.docker === 'mock', 'expected the mock docker driver');
  assert(health.agents?.metrics === true || health.agents?.metrics?.running === true, 'metrics agent not running');

  const email = `tc01-${Date.now()}@example.com`;
  const password = 'correct-horse-battery';
  let instanceId = null;
  let orderId = null;

  await step('register user', async () => {
    const res = await api('POST', '/api/auth/register', { body: { email, password }, auth: false });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(res.json.user.email === email, 'registered email mismatch');
    assert(!('passwordHash' in res.json.user), 'response leaked passwordHash');
    assert(cookie.startsWith('cj_session='), 'no session cookie issued');
    return res.json.user.id;
  });

  await step('login user', async () => {
    const res = await api('POST', '/api/auth/login', { body: { email, password }, auth: false });
    assert(res.status === 200, `expected 200, got ${res.status}: ${res.text}`);
    assert(cookie.startsWith('cj_session='), 'no session cookie issued');
    return 'session cookie set';
  });

  await step('reject bad password', async () => {
    const res = await api('POST', '/api/auth/login', {
      body: { email, password: 'definitely-not-the-password' },
      auth: false,
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
    assert(res.json?.error?.code === 'INVALID_CREDENTIALS', 'unexpected error code');
    assert(!/password|email/i.test(res.json?.error?.message ?? ''), 'error message leaks credential detail');
    return '401 INVALID_CREDENTIALS';
  });

  await step('GET /api/auth/me', async () => {
    const res = await api('GET', '/api/auth/me');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.json.user.email === email, 'wrong user returned');
    return res.json.user.role;
  });

  await step('create order (checkout)', async () => {
    const res = await api('POST', '/api/instances', { body: { planId: 'plan_daily' } });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(res.json.checkoutUrl, 'no checkoutUrl returned');
    assert(res.json.orderId, 'no orderId returned');
    assert(res.json.amountIdr === 15000, `unexpected amount ${res.json.amountIdr}`);
    orderId = res.json.orderId;
    return `order ${orderId.slice(0, 8)}…`;
  });

  let provisionStarted = 0;

  await step('settle order via mock-pay', async () => {
    assert(orderId, 'no order to settle');
    provisionStarted = Date.now();
    const res = await api('POST', `/api/payments/${orderId}/mock-pay`);
    assert(res.status === 200, `expected 200, got ${res.status}: ${res.text}`);
    assert(res.json.settled === true, 'order was not settled');
    return `order ${res.json.status}`;
  });

  await step('instance reaches running < 5s', async () => {
    const deadline = Date.now() + PROVISION_BUDGET_MS;
    let last = null;
    while (Date.now() < deadline) {
      const res = await api('GET', '/api/instances');
      assert(res.status === 200, `expected 200, got ${res.status}`);
      last = res.json.instances[0] ?? null;
      if (last && last.status === 'running') {
        const elapsed = Date.now() - provisionStarted;
        assert(elapsed < PROVISION_BUDGET_MS, `provisioning took ${elapsed}ms (budget ${PROVISION_BUDGET_MS}ms)`);
        instanceId = last.id;
        return `running in ${elapsed}ms`;
      }
      if (last && last.status === 'failed') throw new Error(`provisioning failed: ${last.failureReason}`);
      await sleep(100);
    }
    throw new Error(`instance never reached running (last status: ${last?.status ?? 'none'})`);
  });

  await step('ports and container are assigned', async () => {
    const res = await api('GET', `/api/instances/${instanceId}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const inst = res.json.instance;
    assert(inst.containerId, 'no containerId');
    assert(
      Number.isInteger(inst.wsPort) && inst.wsPort >= 6000 && inst.wsPort <= 7000,
      `wsPort ${inst.wsPort} outside 6000-7000`,
    );
    assert(
      Number.isInteger(inst.vncPort) && inst.vncPort >= 5900 && inst.vncPort <= 6000,
      `vncPort ${inst.vncPort} outside 5900-6000`,
    );
    assert(!('vncPassword' in inst), 'detail response leaked vncPassword');
    return `ws:${inst.wsPort} vnc:${inst.vncPort}`;
  });

  await step('list never leaks vncPassword', async () => {
    const res = await api('GET', '/api/instances');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const raw = JSON.stringify(res.json);
    assert(!raw.includes('vncPassword'), 'list response contains vncPassword');
    assert(!raw.includes('passwordHash'), 'list response contains passwordHash');
    return `${res.json.instances.length} instance(s), no secrets`;
  });

  let token = null;
  let wsPath = null;

  await step('connect returns ticket + RFB password', async () => {
    const res = await api('GET', `/api/instances/${instanceId}/connect`);
    assert(res.status === 200, `expected 200, got ${res.status}: ${res.text}`);
    token = res.json.token;
    wsPath = res.json.wsPath;
    assert(typeof token === 'string' && token.length > 20, 'missing token');
    assert(typeof res.json.expiresAt === 'string', 'missing expiresAt');
    assert(typeof res.json.rfbPassword === 'string' && res.json.rfbPassword.length === 20, 'missing/short rfbPassword');
    assert(wsPath.endsWith('/websockify'), `wsPath must end with /websockify, got ${wsPath}`);
    assert(wsPath.includes(instanceId), 'wsPath does not reference the instance');
    return wsPath;
  });

  await step('authorize accepts a valid ticket', async () => {
    const uri = `${wsPath}?token=${encodeURIComponent(token)}`;
    const res = await fetch(`${BASE}/api/vnc/authorize`, {
      headers: { 'x-original-uri': uri },
      signal: AbortSignal.timeout(5000),
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    return '200';
  });

  await step('authorize rejects a tampered ticket', async () => {
    // Flip one character of the signature: same length, invalid MAC.
    const parts = token.split('.');
    const sig = parts[2];
    const flipped = `${sig.slice(0, 5)}${sig[5] === 'A' ? 'B' : 'A'}${sig.slice(6)}`;
    const bad = `${parts[0]}.${parts[1]}.${flipped}`;
    const res = await fetch(`${BASE}/api/vnc/authorize`, {
      headers: { 'x-original-uri': `${wsPath}?token=${encodeURIComponent(bad)}` },
      signal: AbortSignal.timeout(5000),
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
    return '401';
  });

  await step('foreign instance is a 404, not a 403', async () => {
    // Ownership must not be inferable: another account asking for this id gets
    // exactly the same answer as for an id that never existed.
    const ownerCookie = cookie;
    const other = await api('POST', '/api/auth/register', {
      body: { email: `tc01-other-${Date.now()}@example.com`, password },
      auth: false,
    });
    assert(other.status === 201, `second registration failed: ${other.status} ${other.text}`);
    const otherCookie = cookie;
    assert(otherCookie !== ownerCookie, 'second user received the same session');

    const foreign = await api('GET', `/api/instances/${instanceId}`);
    assert(foreign.status === 404, `expected 404 for a foreign instance, got ${foreign.status}`);
    assert(foreign.json?.error?.code === 'NOT_FOUND', 'foreign instance leaked a different error code');

    const foreignAction = await api('POST', `/api/instances/${instanceId}/stop`);
    assert(foreignAction.status === 404, `expected 404 on foreign action, got ${foreignAction.status}`);

    const admin = await api('GET', '/api/admin/instances');
    assert(admin.status === 403, `expected 403 for a non-admin on /api/admin/instances, got ${admin.status}`);

    cookie = ownerCookie;
    return '404 + admin 403';
  });

  await step('stop instance', async () => {
    const res = await api('POST', `/api/instances/${instanceId}/stop`);
    assert(res.status === 200, `expected 200, got ${res.status}: ${res.text}`);
    assert(res.json.instance.status === 'stopped', `expected stopped, got ${res.json.instance.status}`);
    return 'stopped';
  });

  await step('start instance', async () => {
    const res = await api('POST', `/api/instances/${instanceId}/start`);
    assert(res.status === 200, `expected 200, got ${res.status}: ${res.text}`);
    assert(res.json.instance.status === 'running', `expected running, got ${res.json.instance.status}`);
    return 'running';
  });

  await step('restart instance', async () => {
    const res = await api('POST', `/api/instances/${instanceId}/restart`);
    assert(res.status === 200, `expected 200, got ${res.status}: ${res.text}`);
    assert(res.json.instance.status === 'running', `expected running, got ${res.json.instance.status}`);
    return 'running';
  });

  await step('reset re-provisions with a fresh password', async () => {
    const before = await api('GET', `/api/instances/${instanceId}/connect`);
    assert(before.status === 200, `connect before reset failed: ${before.status}`);
    const oldPassword = before.json.rfbPassword;

    const res = await api('POST', `/api/instances/${instanceId}/reset`);
    assert(res.status === 202, `expected 202, got ${res.status}: ${res.text}`);

    const deadline = Date.now() + PROVISION_BUDGET_MS;
    let status = 'provisioning';
    while (Date.now() < deadline) {
      const list = await api('GET', `/api/instances/${instanceId}`);
      status = list.json.instance.status;
      if (status === 'running') break;
      if (status === 'failed') throw new Error(`reset failed: ${list.json.instance.failureReason}`);
      await sleep(100);
    }
    assert(status === 'running', `instance did not return to running after reset (${status})`);

    const after = await api('GET', `/api/instances/${instanceId}/connect`);
    assert(after.status === 200, `connect after reset failed: ${after.status}`);
    assert(after.json.rfbPassword !== oldPassword, 'reset reused the old VNC password');
    // The ticket is deterministic per (instance, user, second) — what matters is
    // that the newly issued one still authorises the rebuilt container.
    assert(typeof after.json.token === 'string' && after.json.token.length > 20, 'missing token after reset');
    const authRes = await fetch(`${BASE}/api/vnc/authorize`, {
      headers: { 'x-original-uri': `${after.json.wsPath}?token=${encodeURIComponent(after.json.token)}` },
      signal: AbortSignal.timeout(5000),
    });
    assert(authRes.status === 200, `ticket issued after reset was rejected: ${authRes.status}`);
    return 'running, new credential';
  });

  await step('metrics endpoint serves samples', async () => {
    // The metrics loop runs every 1000ms in this test; give it one tick.
    let samples = [];
    for (let i = 0; i < 15 && samples.length === 0; i += 1) {
      const res = await api('GET', `/api/instances/${instanceId}/metrics`);
      assert(res.status === 200, `expected 200, got ${res.status}`);
      samples = res.json.samples;
      if (!samples.length) await sleep(200);
    }
    assert(samples.length > 0, 'no metric samples collected');
    assert(typeof samples[0].cpuPercent === 'number', 'sample has no cpuPercent');
    return `${samples.length} sample(s)`;
  });

  await step('delete instance', async () => {
    const res = await api('DELETE', `/api/instances/${instanceId}`);
    assert(res.status === 204, `expected 204, got ${res.status}: ${res.text}`);
    return '204';
  });

  await step('deleted instance is gone', async () => {
    const res = await api('GET', `/api/instances/${instanceId}`);
    assert(res.status === 404, `expected 404, got ${res.status}`);
    const list = await api('GET', '/api/instances');
    assert(list.json.instances.length === 0, 'instance still listed');
    return '404 / empty list';
  });

  await step('second instance provisions with released ports', async () => {
    const order = await api('POST', '/api/instances', { body: { planId: 'plan_daily' } });
    assert(order.status === 201, `expected 201, got ${order.status}: ${order.text}`);
    const pay = await api('POST', `/api/payments/${order.json.orderId}/mock-pay`);
    assert(pay.status === 200, `expected 200, got ${pay.status}: ${pay.text}`);

    const deadline = Date.now() + PROVISION_BUDGET_MS;
    while (Date.now() < deadline) {
      const res = await api('GET', '/api/instances');
      const inst = res.json.instances.find((i) => i.status === 'running');
      if (inst) {
        assert(
          Number.isInteger(inst.wsPort) && inst.wsPort >= 6000 && inst.wsPort <= 7000,
          `second wsPort ${inst.wsPort} outside range`,
        );
        // Port reuse after release is exactly what the allocator is for; both
        // instances must be able to hold valid, distinct ports.
        const connect = await api('GET', `/api/instances/${inst.id}/connect`);
        assert(connect.status === 200, `second connect failed: ${connect.status}`);
        await api('DELETE', `/api/instances/${inst.id}`);
        return `ws:${inst.wsPort} vnc:${inst.vncPort}`;
      }
      await sleep(100);
    }
    throw new Error('second instance never reached running');
  });

  // A live API must not leak internals on unknown routes.
  await step('unknown route returns structured 404', async () => {
    const res = await api('GET', '/api/does-not-exist');
    assert(res.status === 404, `expected 404, got ${res.status}`);
    assert(res.json?.error?.code === 'NOT_FOUND', 'missing error code');
    return '404 NOT_FOUND';
  });
}

// ── entrypoint ────────────────────────────────────────────────────────────────
let exitCode = 1;
try {
  await main();
} catch (err) {
  if (!fatal) {
    fatal = true;
    record('unexpected error', false, err.message);
  }
} finally {
  await stopServer();
  printTable();
  const failed = results.filter((r) => r.ok === false).length;
  if (failed > 0 && serverLog.trim()) {
    process.stdout.write('── server log (last 4000 chars) ──\n');
    process.stdout.write(`${serverLog.slice(-4000)}\n`);
  }
  exitCode = failed === 0 ? 0 : 1;
}

process.exit(exitCode);
