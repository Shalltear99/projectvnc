# Operations

Everything an operator needs that is not a code change.

## Host prerequisites

Ubuntu 22.04/24.04 or Debian 12, 4 vCPU / 8 GB RAM / 50 GB NVMe minimum
(`docs/deployment.md` §1). Docker Engine 24+, Compose v2, nginx (or the nginx
container in the compose stack), certbot.

## Deploy order

```bash
# 1. worker image must exist before the API can provision anything
docker build -t cloudjava-worker:latest ../worker-node

# 2. secrets
cp .env.example .env && $EDITOR .env

# 3. control plane
docker compose up -d --build

# 4. egress firewall for worker containers
sudo ./iptables-worker-egress.sh docker0

# 5. janitor (belt and braces: the API also runs one in-process)
sudo cp systemd/cloudjava-janitor.service /etc/systemd/system/
sudo systemctl enable --now cloudjava-janitor

# 6. TLS
sudo certbot --nginx -d vnc.example.com
```

## What runs where

| Process | Where | Responsibility |
| --- | --- | --- |
| `nginx` | host or container | TLS, WSS upgrade, ticket validation via `auth_request` |
| `api` | container, mounts `docker.sock` | REST, provisioning, metrics, janitor |
| `dashboard` | container | Next.js UI + noVNC static assets |
| `agent-daemon.js` | host systemd | out-of-band reaper, survives an API outage |
| worker containers | runtime, one per session | X + Openbox + JRE + websockify |

## The docker socket is the crown jewel

The `api` container mounts `/var/run/docker.sock`. Anything that can talk to
that socket can root the host. Consequences:

- never publish port 4000 to the internet, even with auth in front;
- never mount the socket into the dashboard or nginx;
- if you split the control plane across hosts, replace the socket with a
  socket-proxy that whitelists only container create/start/stop/remove.

## Verifying a deploy

```bash
# control plane health
curl -s https://vnc.example.com/api/admin/health | jq

# nginx is routing, not 502-ing
curl -sI https://vnc.example.com/healthz | head -1

# a stream URL without a ticket must be rejected, not proxied
curl -sI https://vnc.example.com/vnc-stream/anything/websockify | head -1   # 401/404

# worker isolation, on a live instance
../worker-node/verify-container.sh cloudjava-<instance-id> <vnc-password>
```

## Incident playbook

**Instances keep dying.** Check `docker stats --no-stream` for OOM kills. The
worker sets `MemorySwap == Memory`, so a runaway JVM is OOM-killed instead of
thrashing the host. Raise `INSTANCE_MEMORY_MB` for the affected plan.

**A user reports "Failed to connect to server".** In order: (1) is the instance
`running` in the API, (2) does `/api/instances/:id/connect` return a ticket,
(3) does the nginx access log show `inst=<id> up=<port>` with a real port,
(4) does `docker port <id>` show a `127.0.0.1` mapping. The nginx log format is
built to answer exactly these four questions.

**Suspected abuse.** `docker inspect` the container, then
`nsenter -t <pid> -n iptables -P OUTPUT DROP` to freeze egress without losing
the evidence. The JanitorAgent does this automatically on a sustained 95% CPU
anomaly, but a manual freeze is faster.

**Expired containers piling up.** `cd backend && node agent-daemon.js --once`
and read the summary. If it reports zero while containers exist, the containers
are missing the `cloudjava.managed=true` label — that means they were created
outside the control plane.

## Backups

Only postgres matters. Worker containers are disposable by design; user game
files live in the named volume `cloudjava-<instanceId>` and are deleted with the
instance, which is the documented behaviour (PRD §4.4 automated cleanup).

```bash
docker exec -t cloudjava-postgres-1 pg_dump -U cloudjava cloudjava | gzip > backup-$(date +%F).sql.gz
```
