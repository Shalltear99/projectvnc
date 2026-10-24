#!/usr/bin/env bash
# Full-stack smoke test against a REAL Docker daemon.
#
# Unlike backend/scripts/integration-test.mjs (which uses the mock driver so it
# can run in CI), this script provisions an actual worker container, then proves
# the four layers that a user experiences:
#
#   1. the API creates and starts a real container with the mandated isolation
#   2. the container's RFB port is not reachable from the host
#   3. nginx proxies the authenticated stream path to that container
#   4. the desktop inside the container is actually painting pixels
#
# Usage: sudo ./ops/fullstack-smoke.sh [api-base]
set -uo pipefail

API="${1:-http://127.0.0.1:4000}"
EMAIL="smoke-$(date +%s)@example.test"
PASS="smoke-test-password-123"
JAR=$(mktemp)
fail=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Read a field from the JSON on stdin. Accepts both a bare object/array and the
# {"instances": [...]} envelope. The expression is evaluated with a leading `d`,
# e.g. jqv "['instances'][0]['status']".
# NB: the program is passed with -c, not a heredoc — a heredoc would consume the
# stdin that carries the JSON.
jqv() {
    python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    v = eval("d" + sys.argv[1])
except Exception:
    v = ""
print("" if v is None else v)
' "$1" 2>/dev/null
}

step "1. account"
curl -s -c "$JAR" -X POST "$API/api/auth/register" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" -o /tmp/fs-reg.json
code=$(curl -s -c "$JAR" -b "$JAR" -o /dev/null -w '%{http_code}' -X POST "$API/api/auth/login" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
if [ "$code" = "429" ]; then
    # The login limiter is 5 attempts/minute per IP (docs/security.md). Running
    # this script repeatedly trips it — that is the limiter working, not a bug,
    # so wait out the window instead of reporting a false failure.
    echo "  .... rate limited (expected on repeated runs); waiting 62s"
    sleep 62
    code=$(curl -s -c "$JAR" -b "$JAR" -o /dev/null -w '%{http_code}' -X POST "$API/api/auth/login" \
        -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
fi
[ "$code" = "200" ] && ok "login 200" || bad "login returned $code"

step "2. purchase"
order=$(curl -s -b "$JAR" -X POST "$API/api/instances" -H 'Content-Type: application/json' \
    -d '{"planId":"plan_daily"}')
oid=$(printf '%s' "$order" | jqv "['orderId']")
[ -z "$oid" ] && oid=$(printf '%s' "$order" | jqv "['order']['id']")
if [ -z "$oid" ]; then
    bad "no order id in response: $order"
    exit 1
fi
ok "order $oid created"

pay=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' -X POST "$API/api/payments/$oid/mock-pay" -H 'Content-Type: application/json' -d '{}')
[ "$pay" = "200" ] || [ "$pay" = "202" ] && ok "mock-pay accepted ($pay)" || bad "mock-pay returned $pay"

step "3. provisioning (real container)"
iid=""
for _ in $(seq 1 60); do
    list=$(curl -s -b "$JAR" "$API/api/instances")
    iid=$(printf '%s' "$list" | jqv "['instances'][0]['id']")
    st=$(printf '%s' "$list" | jqv "['instances'][0]['status']")
    [ "$st" = "running" ] && break
    [ "$st" = "failed" ] && break
    sleep 0.5
done
if [ "$st" = "running" ]; then
    ok "instance $iid is running"
else
    bad "instance status is '$st'"
    printf '%s\n' "$list"
    exit 1
fi

step "4. container isolation"
cid=$(docker ps --filter "label=cloudjava.instance_id=$iid" --format '{{.ID}}' | head -1)
[ -n "$cid" ] && ok "container ${cid:0:12} exists" || bad "no container found for the instance"

uid=$(docker exec "$cid" id -u 2>/dev/null)
[ "$uid" = "1000" ] && ok "runs as uid 1000" || bad "uid=$uid"

caps=$(docker inspect -f '{{.HostConfig.CapDrop}}' "$cid" 2>/dev/null)
case "$caps" in *ALL*) ok "capabilities dropped" ;; *) bad "CapDrop=$caps" ;; esac

step "5. RFB must not be reachable from the host"
pub=$(docker port "$cid" 5901 2>/dev/null)
[ -z "$pub" ] && ok "5901 not published" || bad "5901 published as $pub"

# The published mapping must be loopback-only
map=$(docker inspect -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' "$cid" 2>/dev/null)
case "$map" in
    127.0.0.1:*) ok "only loopback published ($map)" ;;
    *) bad "port mapping is '$map'" ;;
esac

step "6. stream ticket"
conn=$(curl -s -b "$JAR" "$API/api/instances/$iid/connect")
wspath=$(printf '%s' "$conn" | jqv "['wsPath']")
token=$(printf '%s' "$conn" | jqv "['token']")
rfb=$(printf '%s' "$conn" | jqv "['rfbPassword']")
[ -n "$wspath" ] && ok "wsPath $wspath" || bad "no wsPath: $conn"
[ -n "$token" ] && ok "ticket issued (${#token} chars)" || bad "no ticket"
[ -n "$rfb" ] && ok "RFB password issued (${#rfb} chars)" || bad "no RFB password"

step "7. proxy authorisation"
authz=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Original-URI: $wspath?token=$token" "$API/api/vnc/authorize")
[ "$authz" = "200" ] && ok "authorize accepts valid ticket" || bad "authorize returned $authz"
bad_authz=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Original-URI: $wspath?token=deadbeef" "$API/api/vnc/authorize")
[ "$bad_authz" = "401" ] && ok "authorize rejects tampered ticket" || bad "tampered ticket returned $bad_authz"

step "8. desktop is painting pixels"
SRC_SHOT="$(cd "$(dirname "$0")/../worker-node/tools" && pwd)/Screenshot.java"
if [ ! -f "$SRC_SHOT" ]; then
    bad "missing $SRC_SHOT"
else
    # NB: copy into and out of $HOME, never /tmp. The worker mounts /tmp as
    # tmpfs, and `docker cp` operates on the image layer *underneath* the mount:
    # it exits 0 while the file stays invisible in both directions.
    docker cp "$SRC_SHOT" "$cid:/home/cloudjava/Screenshot.java" 2>/tmp/smoke-cp.err
    cap_err=$(docker exec "$cid" sh -c 'mkdir -p /home/cloudjava/build && javac -d /home/cloudjava/build /home/cloudjava/Screenshot.java && HOME=/home/cloudjava XAUTHORITY=/home/cloudjava/.Xauthority DISPLAY=:1 java -cp /home/cloudjava/build Screenshot /home/cloudjava/smoke.png' 2>&1)
    if docker cp "$cid:/home/cloudjava/smoke.png" /tmp/smoke.png 2>/dev/null; then
        # Assert the framebuffer really is painted, not merely captured: the
        # first pixel must be the slate background the launcher sets. A blank
        # (unpainted) root window would be black, so this distinguishes
        # "X is running" from "something is actually drawing".
        read -r dims first_px uniq <<EOF
$(python3 -c '
import zlib, struct
d = open("/tmp/smoke.png", "rb").read()
w, h = struct.unpack(">II", d[16:24])
i, idat = 8, b""
while i < len(d):
    ln = struct.unpack(">I", d[i:i+4])[0]
    if d[i+4:i+8] == b"IDAT":
        idat += d[i+8:i+8+ln]
    i += 12 + ln
raw = zlib.decompress(idat)
stride = w * 3 + 1
px = "#%02X%02X%02X" % tuple(raw[1:4])
uniq = set()
for y in range(0, h, 41):
    row = raw[y*stride+1:(y+1)*stride]
    for x in range(0, w*3, 101):
        uniq.add(tuple(row[x:x+3]))
print(f"{w}x{h}", px, len(uniq))
')
EOF
        [ "$dims" = "1280x720" ] && ok "framebuffer ${dims}" || bad "unexpected geometry '$dims'"
        [ "$first_px" = "#0F172A" ] && ok "background painted slate-900 ($first_px)" \
            || bad "root window is $first_px, expected #0F172A"
        [ "${uniq:-0}" -ge 1 ] && ok "$uniq distinct colour(s) in frame" || bad "frame is empty"
    else
        bad "could not capture the framebuffer"
        printf '       capture output: %s\n' "${cap_err:-<none>}"
    fi
fi

step "9. cleanup"
curl -s -b "$JAR" -o /dev/null -X DELETE "$API/api/instances/$iid"
sleep 2
if docker ps -a --filter "label=cloudjava.instance_id=$iid" --format '{{.ID}}' | grep -q .; then
    bad "container survived deletion"
else
    ok "container removed"
fi

rm -f "$JAR"
echo
if [ "$fail" -eq 0 ]; then
    printf '\033[32mfull stack OK\033[0m\n'
else
    printf '\033[31m%s check(s) failed\033[0m\n' "$fail"
    exit 1
fi
