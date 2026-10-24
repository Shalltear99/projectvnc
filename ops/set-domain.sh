#!/usr/bin/env bash
# Point the running demo at a public origin (a Cloudflare tunnel hostname).
#
# Why this exists: the dashboard is a static Next.js build, and
# NEXT_PUBLIC_API_BASE is inlined into the JS bundle at build time. Changing the
# public hostname therefore requires a REBUILD, not just an env var on the API.
# A tunnel that only proxies traffic produces a page that loads fine and then
# fails every action, because the bundle still points at localhost.
#
# Also: the API reflects exactly one CORS origin (PUBLIC_BASE_URL). If the two
# values disagree the browser blocks the cookie-bearing requests with a bare
# "Failed to fetch" and no server-side log line.
#
# Usage:  ops/set-domain.sh vnc.example.com
#         ops/set-domain.sh --local          # back to 127.0.0.1:8080
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/ops/run"
NGINX_DIR="${NGINX_DIR:-/tmp/cjrun}"
mkdir -p "$RUN"

if [ $# -ne 1 ]; then
    echo "usage: $0 <domain>   |   $0 --local" >&2
    exit 2
fi

if [ "$1" = "--local" ]; then
    ORIGIN="http://127.0.0.1:8080"
else
    # Accept a bare hostname or a full URL; normalise to https://host[:port].
    case "$1" in
        http://*|https://*) ORIGIN="${1%/}" ;;
        *)                  ORIGIN="https://${1%/}" ;;
    esac
fi

echo "==> public origin: $ORIGIN"

# --- stop whatever is serving the dashboard / API -----------------------------
stop_port() {
    local port="$1" pid
    pid=$(sudo ss -ltnp 2>/dev/null | grep ":$port " | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -1 || true)
    if [ -n "${pid:-}" ]; then
        kill "$pid" 2>/dev/null || true
        for _ in $(seq 1 20); do
            kill -0 "$pid" 2>/dev/null || break
            sleep 0.25
        done
        echo "    stopped :$port (pid $pid)"
    fi
}
stop_port 3000
stop_port 4000

# --- rebuild the dashboard with the new API base -----------------------------
echo "==> building dashboard (NEXT_PUBLIC_API_BASE=$ORIGIN)"
cd "$ROOT/frontend"
NEXT_PUBLIC_API_BASE="$ORIGIN" npm run build > "$RUN/build.log" 2>&1 || {
    echo "!! build failed — see $RUN/build.log" >&2
    tail -20 "$RUN/build.log" >&2
    exit 1
}
# Prove the value actually made it into the bundle; a silent miss here is the
# exact failure this script exists to prevent.
if ! grep -rqs "$ORIGIN" .next/static/chunks/pages/; then
    echo "!! $ORIGIN is not in the built bundle — refusing to start" >&2
    exit 1
fi
echo "    bundle contains the origin: ok"

# --- start the API ------------------------------------------------------------
echo "==> starting API on :4000"
cd "$ROOT/backend"
NODE_ENV=development \
DATABASE_DRIVER="${DATABASE_DRIVER:-memory}" \
DOCKER_DRIVER="${DOCKER_DRIVER:-docker}" \
WORKER_IMAGE="${WORKER_IMAGE:-cloudjava-worker:latest}" \
PROVISION_TIMEOUT_MS="${PROVISION_TIMEOUT_MS:-20000}" \
PAYMENT_PROVIDER="${PAYMENT_PROVIDER:-mock}" \
PORT=4000 \
LOG_LEVEL="${LOG_LEVEL:-info}" \
PUBLIC_BASE_URL="$ORIGIN" \
PROXY_MODE="${PROXY_MODE:-nginx}" \
NGINX_MAP_FILE="${NGINX_MAP_FILE:-$NGINX_DIR/conf.d/cloudjava_upstreams.map}" \
NGINX_RELOAD_CMD="${NGINX_RELOAD_CMD:-$NGINX_DIR/reload.sh}" \
    setsid sg docker -c "node dist/index.js" > "$RUN/api.log" 2>&1 &
echo $! > "$RUN/api.pid"

# --- start the dashboard ------------------------------------------------------
echo "==> starting dashboard on :3000"
cd "$ROOT/frontend"
setsid npx next start -p 3000 -H 127.0.0.1 > "$RUN/frontend.log" 2>&1 &
echo $! > "$RUN/frontend.pid"

# --- wait for readiness, don't assume -----------------------------------------
for i in $(seq 1 40); do
    api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:4000/api/admin/health || true)
    fe=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:3000/login || true)
    [ "$api" = "200" ] && [ "$fe" = "200" ] && break
    sleep 1
done

echo
echo "    API  :4000 -> ${api:-no response}"
echo "    web  :3000 -> ${fe:-no response}"
if [ "$api" != "200" ] || [ "$fe" != "200" ]; then
    echo "!! services did not come up; see $RUN/api.log and $RUN/frontend.log" >&2
    exit 1
fi

cat <<EOF

Ready. The app now believes it is served from:
    $ORIGIN

Next step (yours): point the tunnel at the nginx front door, not at :3000 —
nginx is what rewrites /api and proxies the VNC websocket.

    cloudflared tunnel --url http://127.0.0.1:8080     # quick tunnel
  or, for a named tunnel with your own domain:
    cloudflared tunnel create cloudjava
    cloudflared tunnel route dns cloudjava $([ "$1" = "--local" ] && echo vnc.example.com || echo "${ORIGIN#https://}")
    cloudflared tunnel run --url http://127.0.0.1:8080 cloudjava

Local check:  curl -I $ORIGIN/login
EOF
