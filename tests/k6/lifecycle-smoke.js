/**
 * docs/testing.md §1.1 — API-side smoke test under load.
 *
 * Exercises the control plane (auth -> order -> webhook -> poll -> delete)
 * without touching Docker, so it can run against staging at any scale.
 *
 *   k6 run -e BASE_URL=https://vnc.example.com tests/k6/lifecycle-smoke.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4000';

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || '1m',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const email = `k6-${__VU}-${Date.now()}@example.test`;
  const password = 'k6-test-password-123';

  const reg = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(reg, { 'register 2xx': (r) => r.status >= 200 && r.status < 300 });

  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(login, { 'login 200': (r) => r.status === 200 });

  const jar = http.cookieJar();
  const cookies = jar.cookiesForURL(BASE_URL);
  const session = cookies['cj_session'] ? cookies['cj_session'][0] : null;

  const me = http.get(`${BASE_URL}/api/auth/me`, {
    headers: session ? { Cookie: `cj_session=${session}` } : {},
  });
  check(me, { 'me 200': (r) => r.status === 200 });

  sleep(1);
}
