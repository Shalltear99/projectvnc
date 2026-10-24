# CloudJava VNC — Backend Control Plane

Express + TypeScript control plane for CloudJava VNC: authentication, orders,
container provisioning, VNC stream tickets, telemetry and the janitor.

One container = one user session. The container publishes **only** websockify on
6080, which the host binds to `127.0.0.1:<ws_port>` (`6000-7000`). The RFB
listener stays inside the container on `127.0.0.1:5901` and is never published.
nginx maps `/vnc-stream/<instanceId>` to that port through a generated map file.

```
browser ──wss──▶ nginx (/vnc-stream/<id>) ──▶ 127.0.0.1:<ws_port> ──▶ websockify ──▶ 127.0.0.1:5901 (RFB)
                    │
                    └─ auth_request ──▶ GET /api/vnc/authorize  (HMAC ticket)
```

---

## 1. Quick start

```bash
cd backend
npm install

# development (in-memory store, mock docker driver, noop proxy — no daemon needed)
cp .env.example .env
npm run dev                     # tsx watch src/index.ts, listens on :4000

# production build
npm run build                   # tsc -> dist/
NODE_ENV=production node dist/index.js
```

Required for production: `DATABASE_DRIVER=postgres` + `DATABASE_URL`,
`DOCKER_DRIVER=docker`, `PROXY_MODE=nginx`, non-default `JWT_SECRET` /
`VNC_TOKEN_SECRET`. `config.ts` refuses to boot otherwise (exit 78).

### Verification

```bash
npx tsc -p tsconfig.json --noEmit     # typecheck
npm run build                         # dist/
node scripts/integration-test.mjs     # TC-01 end-to-end, spawns its own API
node agent-daemon.js --once           # worker-node janitor, single sweep
```

The integration test boots the API on port `4010` (override with `TEST_PORT`)
using `DATABASE_DRIVER=memory`, `DOCKER_DRIVER=mock`, `PROXY_MODE=noop` and no
`REDIS_URL`, then exercises register → login → order → settle → provision →
connect → stop → start → restart → reset → delete → re-provision.

---

## 2. Environment

| Variable | Default | Notes |
| :--- | :--- | :--- |
| `NODE_ENV` | `development` | `production` enables secure cookies and strict config guards |
| `PORT` | `4000` | API listener |
| `LOG_LEVEL` | `info` | pino level |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | dashboard origin; the only CORS origin allowed |
| `DATABASE_DRIVER` | `memory` | `memory` \| `postgres` (memory is refused in production) |
| `DATABASE_URL` | – | required for `postgres` |
| `REDIS_URL` | – | unset ⇒ in-process event bus; set ⇒ Redis pub/sub |
| `JWT_SECRET` | dev default | ≥16 chars, must not start with `dev-only` in production |
| `JWT_EXPIRES_IN` | `7d` | session cookie lifetime |
| `VNC_TOKEN_SECRET` | dev default | HMAC key for stream tickets |
| `VNC_TOKEN_TTL_SECONDS` | `120` | stream ticket lifetime |
| `DOCKER_DRIVER` | `mock` | `mock` \| `docker`; `mock` forbidden in production |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | |
| `WORKER_IMAGE` | `cloudjava-worker:latest` | image provisioning uses |
| `PROVISION_TIMEOUT_MS` | `5000` | provisioning budget; exceeding it rolls back |
| `VNC_PORT_RANGE_START/END` | `5900/6000` | loopback RFB range |
| `WS_PORT_RANGE_START/END` | `6000/7000` | websockify range (proxied) |
| `INSTANCE_DEFAULT_TTL_MINUTES` | `1440` | plan duration overrides this |
| `MAX_INSTANCES_PER_USER` | `2` | live instances per account |
| `INSTANCE_CPU_LIMIT` / `INSTANCE_MEMORY_MB` / `INSTANCE_PIDS_LIMIT` / `INSTANCE_DISK_MB` | `1.0` / `1024` / `256` / `2048` | host-side cgroup ceiling |
| `JANITOR_INTERVAL_MS` | `60000` | janitor sweep period |
| `METRICS_INTERVAL_MS` | `2000` | metrics sampling period |
| `INACTIVE_STREAM_TIMEOUT_MS` | `900000` | idle threshold before `INSTANCE_IDLE` |
| `ABUSE_CPU_PERCENT` | `95` | abuse threshold |
| `ABUSE_SUSTAIN_MS` | `300000` | how long CPU must stay above it |
| `PROXY_MODE` | `noop` | `nginx` writes the map + reloads, `noop` logs only |
| `NGINX_MAP_FILE` | `/etc/nginx/conf.d/cloudjava_upstreams.map` | generated include |
| `NGINX_RELOAD_CMD` | `nginx -s reload` | |
| `STREAM_PATH_PREFIX` | `/vnc-stream` | |
| `PAYMENT_PROVIDER` | `mock` | `mock` \| `midtrans` \| `xendit` \| `tripay` |
| `MIDTRANS_SERVER_KEY` | – | required for midtrans |
| `XENDIT_CALLBACK_TOKEN` / `XENDIT_API_KEY` | – | required for xendit |
| `TRIPAY_PRIVATE_KEY` / `TRIPAY_MERCHANT_CODE` / `TRIPAY_API_KEY` | – | required for tripay |
| `MOCK_PAYMENT_SECRET` | `mock-payment-secret` | HMAC key for mock webhooks |
| `ENABLE_AGENTS` | `true` | `false` disables provisioning/metrics/janitor |

Selecting a provider without its credentials throws at construction — there is
no silent fallback to `mock`.

---

## 3. Endpoints

### Auth

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| POST | `/api/auth/register` | – | create account (password ≥ 10 chars), sets `cj_session` |
| POST | `/api/auth/login` | – | bcrypt login, 5 attempts/min/IP, generic `invalid credentials` |
| POST | `/api/auth/logout` | – | clears the session cookie (204) |
| GET | `/api/auth/me` | user | current account |

### Instances

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| GET | `/api/instances` | user | caller's instances (never contains `vncPassword`) |
| GET | `/api/instances/:id` | user | single instance (no `vncPassword`) |
| POST | `/api/instances` | user | `{ planId }` → creates a **pending order**, returns `checkoutUrl` |
| POST | `/api/instances/:id/start` | user | start a stopped container |
| POST | `/api/instances/:id/stop` | user | stop a running container (ports stay reserved) |
| POST | `/api/instances/:id/restart` | user | restart the container |
| POST | `/api/instances/:id/reset` | user | 202; destroys the container and re-provisions with a **new** VNC password |
| DELETE | `/api/instances/:id` | user | remove container, release ports, drop the row (204) |
| GET | `/api/instances/:id/connect` | user | `{ wsPath, token, expiresAt, rfbPassword }` |
| GET | `/api/instances/:id/metrics` | user | recent samples (`?limit=`, max 150) |

A foreign instance id returns **404, never 403** — ownership is not inferable.

### Stream authorisation (nginx `auth_request`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| GET | `/api/vnc/authorize` | ticket | reads `X-Original-URI`, parses instance id + `?token=`, verifies the HMAC |

200 = allowed, 401 = everything else (missing/expired/tampered token, instance
mismatch, instance not running). Never 404: nginx maps any non-2xx to a denial.
Mounted before the JSON parser and exempt from the API rate limiter, because a
stream reconnect must not be throttled.

### Payments

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| POST | `/api/webhooks/:provider` | signature | raw body; settles the order and publishes `ORDER_PAID` |
| POST | `/api/payments/:orderId/mock-pay` | user | development settlement (mock provider only) |

### Admin / ops

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| GET | `/api/admin/health` | – | uptime, store/docker/proxy/payment drivers, agent status |
| GET | `/api/admin/instances` | admin | all instances with live container state |
| POST | `/api/admin/janitor/run` | admin | run one janitor sweep, returns the summary |

Errors are always `{ "error": { "code", "message" } }`; stacks never leave the process.

---

## 4. Payment webhook flow

```
dashboard ──POST /api/instances {planId}──▶ API ──createCheckout──▶ gateway
                                             │                      │
                                             ▼                      ▼
                                     orders(status=pending)   hosted page
                                                                    │
   gateway ──POST /api/webhooks/:provider (raw body + signature) ───┘
                     │
                     ├─ provider == PAYMENT_PROVIDER?         no → 404
                     ├─ signature over exact bytes?           no → 401
                     ├─ order by (provider, providerRef)?     no → 200 (ack, no action)
                     ├─ amount == order.amountIdr?            no → 400 + SECURITY_ALERT
                     ├─ already paid?                         yes → 200 duplicate
                     └─ paid → order.status=paid, publish ORDER_PAID
                                                     │
                                        ProvisionerAgent provisions the container
```

Signatures: Midtrans `SHA512(order_id + status_code + gross_amount + serverKey)`;
Xendit `x-callback-token` compared with `timingSafeEqual`; Tripay
`HMAC-SHA256(rawBody, privateKey)` against `X-Callback-Signature`; mock
`HMAC-SHA256(rawBody, MOCK_PAYMENT_SECRET)` in `x-mock-signature`.

Non-terminal states (Midtrans `pending`, Xendit `PENDING`, Tripay `UNPAID`) are
acknowledged with 200 and change nothing. `mock-pay` builds a correctly signed
body and pushes it through the same verification path — development never gets a
settlement bypass.

---

## 5. Agents

| Agent | Trigger | Responsibility |
| :--- | :--- | :--- |
| `ProvisionerAgent` | `ORDER_PAID`, `INSTANCE_REBUILD` | reserve ports, create container, register route, publish `INSTANCE_READY`; roll back and publish `PROVISIONING_FAILED` on timeout/failure |
| `MetricsAgent` | every `METRICS_INTERVAL_MS` | sample cgroup stats into a ring buffer, `INSTANCE_IDLE`, `SECURITY_ALERT: cpu_abuse` |
| `JanitorAgent` | every `JANITOR_INTERVAL_MS` | reap expired sessions, remove orphan containers, re-sync the proxy map, freeze abused instances |

`agent-daemon.js` is the standalone worker-node janitor (docs/agents.md §5): it
sweeps the Docker socket directly for expired and orphaned managed containers
plus stale `/tmp/.X11-unix` locks. Run it as a loop (`node agent-daemon.js`) or
from cron (`node agent-daemon.js --once`). It refuses to start with
`DOCKER_DRIVER=mock` and exits cleanly when the socket is unreachable.

---

## 6. Security invariants

1. **RFB is loopback only.** The container's VNC port (`5901`) is never
   published; only websockify (`6080`) is bound to `127.0.0.1:<ws_port>`, and the
   host firewall drops `5900-6000` on external interfaces.
2. **Containers are unprivileged.** `--user 1000:1000`, `--cap-drop=ALL`,
   `no-new-privileges`, cgroup caps on CPU / memory / pids, `noexec,nosuid` tmpfs.
3. **VNC credentials never appear in list, detail or admin responses.** They are
   returned exactly once, to the authenticated owner, from
   `GET /api/instances/:id/connect`, over TLS — the browser needs the RFB
   password because websockify is a transparent tunnel and cannot inject it.
4. **Streams are authorised per connection.** The browser receives an
   HMAC-SHA256 ticket bound to `(instanceId, userId)` with a short TTL; nginx
   validates it via `auth_request` on every handshake, so a leaked URL dies with
   the ticket.
5. **Provisioning is payment-driven.** `POST /api/instances` creates a pending
   order; only a signature-verified webhook can mark it paid and trigger
   provisioning.
6. **Ports are allocator-owned.** Never hardcoded; always released on failure,
   delete, reset and expiry.
7. **Secrets stay server-side.** `passwordHash` is never serialised, logs redact
   cookies/authorization/passwords, and error responses never carry stacks.
