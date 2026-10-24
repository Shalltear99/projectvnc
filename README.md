# CloudJava VNC

Browser-based Java runtime rental. Users rent an isolated Docker container that
runs a headless X server, Openbox, and an OpenJDK runtime (8/11/17/21), and
interact with it through noVNC over an encrypted WebSocket. One container per
user session, provisioned automatically when payment settles.

> Specification lives in [`docs/`](./docs). Start with `docs/prd.md`, then
> `docs/architecture.md` and `docs/security.md`.

## Architecture at a glance

```
Browser ──HTTPS/WSS:443──► nginx ──┬── /api/*        ──► backend :4000
                                   ├── /            ──► dashboard :3000
                                   └── /vnc-stream/<id> ──► 127.0.0.1:<ws_port>
                                                                │
                                                     worker container (per user)
                                                       Xtigervnc 127.0.0.1:5901
                                                       openbox + OpenJDK
                                                       websockify :6080
```

Isolation invariants, enforced in code, not by convention:

- **RFB is never published.** `Xtigervnc` binds `127.0.0.1` inside the container;
  the host only maps websockify, and only to `127.0.0.1`.
- **Containers are unprivileged.** `--user 1000:1000`, `--cap-drop=ALL`,
  `no-new-privileges`, cgroup caps on CPU, memory and PIDs.
- **The browser never receives the RFB password.** It gets a short-lived,
  instance-bound HMAC token instead.
- **Expired sessions are reaped automatically** by `JanitorAgent` and the
  standalone `agent-daemon.js`.

## Layout

| Path | Contents |
| --- | --- |
| `docs/` | PRD, architecture, agents, security, design, deployment, tasks, testing |
| `worker-node/` | Worker container image: Dockerfile, supervisord, entrypoint |
| `backend/` | Control plane API, provisioning/metrics/janitor agents, janitor daemon |
| `frontend/` | Next.js dashboard, noVNC viewer, mobile gamepad |
| `nginx/` | Edge proxy: TLS, WSS upgrade, dynamic upstream map |
| `ops/` | Compose stack, egress firewall, systemd units |

## Quick start (development)

No Docker daemon required — the backend ships a mock driver and an in-memory
store so the whole lifecycle is exercisable locally.

```bash
make install

# terminal 1 — control plane
cd backend && cp .env.example .env && npm run dev

# terminal 2 — dashboard
cd frontend && cp .env.local.example .env.local && npm run dev

# terminal 3 — prove the lifecycle works (TC-01)
cd backend && node scripts/integration-test.mjs
```

## Production

```bash
cp ops/.env.example ops/.env    # fill in real secrets
make worker                     # build the worker image
make stack                      # postgres + redis + api + dashboard + nginx
sudo ./ops/iptables-worker-egress.sh docker0
sudo cp ops/systemd/cloudjava-janitor.service /etc/systemd/system/
sudo systemctl enable --now cloudjava-janitor
```

See [`docs/deployment.md`](./docs/deployment.md) for TLS and host prerequisites.

## Capacity

A 2 vCPU / 7 GB host comfortably runs 8–12 capped instances (~300–600 MB each
under a real game). 50 concurrent streams per node (the PRD KPI) needs a node
with ~32 GB and a proper orchestrator — this repository's control plane is
single-node by design.

## Status

Milestones in `docs/tasks.md`. The backend runs on `DATABASE_DRIVER=memory`,
`DOCKER_DRIVER=mock`, `PROXY_MODE=noop` for local development; production
requires postgres, a real Docker socket and nginx map writes.
