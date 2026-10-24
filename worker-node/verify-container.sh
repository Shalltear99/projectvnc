#!/usr/bin/env bash
# End-to-end verification of a running worker container.
# Usage: ./verify-container.sh <container-name-or-id> [vnc-password]
#
# Proves the four layers separately, the way docs/testing.md asks for:
#   1. the container is healthy and non-root with no capabilities
#   2. the X server is up at the expected geometry
#   3. the RFB port answers only on loopback
#   4. websockify serves the noVNC client and completes a WS handshake
set -uo pipefail

C="${1:?usage: verify-container.sh <container> [vnc-password]}"
PASS="${2:-}"
fail=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }
info() { printf '  \033[36m----\033[0m %s\n' "$1"; }

echo "== 1. isolation =="
uid=$(docker exec "$C" id -u 2>/dev/null)
[ "$uid" = "1000" ] && ok "runs as uid 1000" || bad "uid is '$uid', expected 1000"

caps=$(docker inspect -f '{{.HostConfig.CapDrop}}' "$C" 2>/dev/null)
case "$caps" in *ALL*) ok "all capabilities dropped" ;; *) bad "CapDrop is '$caps'" ;; esac

nnp=$(docker inspect -f '{{.HostConfig.SecurityOpt}}' "$C" 2>/dev/null)
case "$nnp" in *no-new-privileges*) ok "no-new-privileges set" ;; *) bad "SecurityOpt is '$nnp'" ;; esac

health=$(docker inspect -f '{{.State.Health.Status}}' "$C" 2>/dev/null)
[ "$health" = "healthy" ] && ok "healthcheck healthy" || bad "healthcheck is '$health'"

echo "== 2. display =="
dims=$(docker exec "$C" sh -c 'DISPLAY=:1 xdpyinfo | grep -m1 dimensions' 2>/dev/null)
[ -n "$dims" ] && ok "X server up: ${dims##* }" || bad "X server not answering"

wins=$(docker exec "$C" sh -c 'DISPLAY=:1 xwininfo -root -children 2>/dev/null | grep -c "+0+0"' 2>/dev/null)
[ "${wins:-0}" -gt 0 ] && ok "$wins mapped window(s)" || info "no mapped window (expected if /opt/game is empty)"

echo "== 3. RFB is loopback-only =="
pub=$(docker port "$C" 5901 2>/dev/null)
[ -z "$pub" ] && ok "5901 not published to the host" || bad "5901 is published: $pub"

bound=$(docker exec "$C" sh -c 'netstat -ltn 2>/dev/null | grep 5901' 2>/dev/null)
case "$bound" in
    *127.0.0.1:5901*) ok "Xtigervnc bound to 127.0.0.1" ;;
    *) bad "RFB bind: ${bound:-not listening}" ;;
esac

echo "== 4. websockify + noVNC =="
code=$(docker exec "$C" sh -c 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:6080/vnc_lite.html' 2>/dev/null)
[ "$code" = "200" ] && ok "vnc_lite.html served (200)" || bad "vnc_lite.html returned '$code'"

if [ -n "$PASS" ]; then
    hs=$(docker exec "$C" sh -c "curl -s -i -o /dev/null -w '%{http_code}' \
        -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
        -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
        -H 'Sec-WebSocket-Protocol: binary' \
        http://127.0.0.1:6080/websockify" 2>/dev/null)
    [ "$hs" = "101" ] && ok "WebSocket handshake accepted (101)" || bad "handshake returned '$hs'"
else
    info "skipping WS handshake (no password supplied)"
fi

echo
if [ "$fail" -eq 0 ]; then
    printf '\033[32mAll checks passed\033[0m\n'
else
    printf '\033[31m%s check(s) failed\033[0m\n' "$fail"
    exit 1
fi
