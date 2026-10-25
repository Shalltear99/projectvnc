# CloudJava VNC — verification log

What was actually executed on this machine, with the commands and observed
results. Kept in the repo so the next person does not have to guess whether a
layer was ever tested.

Host: Ubuntu 24.04, 2 vCPU / 7.4 GB, Docker 29.1.3 (overlayfs, cgroup v2),
Node 22.22, nginx 1.24.

---

## 1. Backend control plane (mock driver, no Docker needed)

```
cd backend
npx tsc -p tsconfig.json --noEmit     # exit 0
npm run build                          # exit 0, dist/ with 36 files
node scripts/integration-test.mjs      # 22 passed, 0 failed, exit 0
node agent-daemon.js --once            # exit 0
```

The integration test covers TC-01: register, login, order, webhook settlement,
provisioning under 5 s, port allocation inside the documented ranges, connect
ticket + RFB credential, authorize accept/reject, ownership 404, stop/start/
restart/reset, metrics, delete, port release, second instance, structured 404.

## 2. Worker image

```
docker build -t cloudjava-worker:latest ./worker-node   # exit 0, 2.1 GB
```

Four JREs (8/11/17/21), TigerVNC, Openbox, websockify 0.12, noVNC 1.5.0,
FreeJ2ME-Plus 1.52, plus `javac` (the PRD sells JDK environments).

## 3. Worker container behaviour

```
docker run -d --name cj-verify --user 1000:1000 --cap-drop=ALL \
  --security-opt no-new-privileges --pids-limit 256 --memory 1g --cpus 1.0 \
  -e VNC_PASSWORD=testpass123 -e JAVA_ENV_VERSION=17 \
  -p 127.0.0.1:6081:6080 -v $PWD/worker-node/sample:/opt/game \
  cloudjava-worker:latest
```

Observed: `Up (healthy)`; supervisord RUNNING xvnc/openbox/game/websockify/
center-windows; `netstat` shows `127.0.0.1:5901` (RFB, loopback) and
`0.0.0.0:6080` (websockify); `xdpyinfo` 1280x720; the sample Swing app compiles
and renders (verified by pixel capture, not by process count).

## 4. Edge proxy

A throwaway nginx instance on the real `nginx/cloudjava.conf`:

```
curl http://127.0.0.1/healthz                      -> 200 "ok"
curl https://127.0.0.1/vnc-stream/<id>/websockify  -> 401   (no ticket)
curl "https://.../websockify?token=good"           -> 200   (upstream reached,
                                                              path rewritten)
curl "https://.../websockify?token=bad"            -> 401
curl https://127.0.0.1/vnc-stream/unknown/...      -> 404   (map default 0)
```

`/` `/login` `/register` `/dashboard` `/novnc/vnc_lite.html` all 200 through the
proxy once the dashboard is up.

## 5. Full stack with a REAL Docker daemon

`ops/fullstack-smoke.sh` — every check passed:

```
1. account                    login 200
2. purchase                   order created, mock-pay 200
3. provisioning (real)        instance running
4. container isolation        uid 1000, CapDrop ALL, no-new-privileges
5. RFB reachability           5901 not published; only 127.0.0.1:6001 mapped
6. stream ticket              wsPath, 186-char ticket, 20-char RFB password
7. proxy authorisation        200 valid / 401 tampered
8. desktop pixels             1280x720, first pixel #0F172A, 4 colours
9. cleanup                    container removed
```

## 6. Browser (headless Chromium, real UI)

Registered through the form, provisioned through the dashboard, launched the
viewer. Result:

```
header:  Connected
noVNC:   "Connected to cloudjava@99b285ea3c4e"
canvas:  present
```

That exercises the whole chain: Next.js → API → order → mock webhook →
ProvisionerAgent → real container → nginx ticket check → websockify → RFB.

---

## Defects found by running it (all fixed)

1. **`-headless` JREs cannot create AWT windows** — no `libawt_xawt.so`, so every
   Swing app dies with `HeadlessException` and the desktop stays an empty void.
   Switched to full JREs plus the X client libraries.
2. **No `javac` in the image** — the sample launcher compiles on first boot and
   the PRD promises JDK environments.
3. **Compiling into a bind mount fails** — `/opt/game` carries the host's
   uid/gid, so `javac -d /opt/game` hits `Permission denied`. Launchers now
   compile into `$HOME/build`.
4. **`docker cp` silently no-ops on a tmpfs `/tmp`** — it writes under the mount
   and exits 0 while the file stays invisible, in both directions. Verification
   tooling uses `$HOME`.
5. **`vnc_lite.html` prepends `/` to `path`** — passing a leading slash produced
   `//vnc-stream/...`, which the token check rejected with a 401 that looked like
   a bad credential. The viewer strips it; the API also normalises, because a
   proxy may hand it either form.
6. **Dashboard crashed on load** — `listInstances` treated the
   `{instances:[...]}` envelope as an array (`x.filter is not a function`).
7. **Provision button did nothing** — the UI ignored the checkout session and
   assumed an instance would appear. It now settles mock orders inline and
   redirects to the gateway otherwise.
8. **Login form could leak the password into the URL** — a submit before React
   hydration performed a native GET. The form is now `method="post"`.
9. **Empty desktop looked broken** — an instance with no game streamed a blank
   rectangle. The worker now shows an idle screen that proves X, JVM, AWT and the
   stream all work, and tells the user what to upload.
10. **The mock checkout link pointed at a non-existent order** — the provider
    embedded `order.id` from a *provisional* object whose id is never persisted,
    so `/checkout/mock?orderId=…` settled with `404 order not found`. The URL now
    carries only the provider reference, and `POST /api/payments/:key/mock-pay`
    accepts either our order id or that reference (ownership still enforced —
    another user's reference is a 404, verified).
11. **A blank `NEXT_PUBLIC_API_BASE` silently made every API call relative** —
    `??` does not treat `''` as unset, so `NEXT_PUBLIC_API_BASE=` produced
    `API_BASE=''` and the browser called the Next.js server, which has no `/api`
    routes: every action 404'd with no explanation. Blank now falls back to the
    default.
12. **The idle card was invisible** — it painted slate-900 on a slate-900 root
    window. It now uses the card surface from design.md with a border.
13. **Window centring never ran** — `xwininfo` prints the window name between the
    id and the geometry, so the combined regex matched nothing and the loop
    silently did nothing. Id and size are now parsed separately, largest window
    wins; verified `720x460 -> 280,130` on `1280x720` and re-centred after a
    client resize.

## Running it locally (verified recipe)

Two shapes, both exercised end to end.

**Direct (dashboard on 3000, API on 4000):**

```
cd backend  && DATABASE_DRIVER=memory DOCKER_DRIVER=docker \
  WORKER_IMAGE=cloudjava-worker:latest PAYMENT_PROVIDER=mock PORT=4000 \
  node dist/index.js
cd frontend && NEXT_PUBLIC_API_BASE=http://localhost:4000 npm run build \
  && npx next start -p 3000
```

Open **http://localhost:3000** — not `127.0.0.1:3000`. CORS reflects exactly one
origin (`PUBLIC_BASE_URL`, default `http://localhost:3000`), so the other spelling
is blocked by the browser with a bare "Failed to fetch".

**Through nginx (the real topology, stream included):**

```
backend: PROXY_MODE=nginx NGINX_MAP_FILE=<map> NGINX_RELOAD_CMD=<reload> \
         PUBLIC_BASE_URL=http://127.0.0.1:8080
frontend: NEXT_PUBLIC_API_BASE=http://127.0.0.1:8080 npm run build
```

Then browse the nginx origin. Without `PROXY_MODE=nginx` the API still reports
`/vnc-stream/<id>/websockify` as the stream path but nothing rewrites the upstream
map, so the viewer sits at "Connecting" and gives up.

**Two traps that cost time and look like product bugs:**

- Rebuilding `frontend/` while `next start` is running leaves the server serving
  the old chunk hashes; those chunks 404, the page never hydrates, and *every*
  button and form silently does nothing. Restart the server after every build.
- The integration suite binds port 4010. A leftover dev server on 4010 makes it
  fail with `EADDRINUSE` before the first assertion.

## Workspace redesign (v2 UI)

The instance page moved to `/dashboard/vnc/[instanceId]`; `/instances/[id]` is now
a redirect. Defects found while building and exercising it:

- **Metrics silently read as zero.** `/api/instances/:id/metrics` returns
  `{ samples: [...] }`, but the normaliser only unwrapped `data`/`metrics` and
  otherwise read the root. CPU rendered `0%` and RAM `—` while the API was
  returning real numbers. A wrong-but-plausible `0%` is worse than an error, so
  the normaliser now takes the last sample of `samples`.
- **Stream permanently dead after Restart.** Re-minting the ticket inside the
  action handler connected to a container that was still shutting down; the
  socket opened and was killed at once, leaving "connection is closed" forever.
  Reconnection is now an auto-heal effect gated on the API reporting the
  instance `running`, capped at 4 attempts.
- **`#top_bar` injection did nothing.** The iframe fires `load` while still on
  `about:blank`; injecting the hide-chrome stylesheet there is lost when the
  viewer document commits. Injection now polls until `#screen` exists.
- **Plan label fell through to "Monthly".** `planId` is `plan_daily`, not
  `daily`, so an equality check against `'daily'` never matched.
- **`truncate` did not truncate.** A flex child will not shrink below its
  content width; the long proxy path needed `min-w-0` alongside `truncate`.

Hiding `#top_bar` also removes noVNC's own Ctrl+Alt+Del button, so the overlay
carries a `CAD` button that calls `rfb.sendCtrlAltDel()`.

## Fitting the emulator to the screen (desktop and mobile)

`fit-window.sh` scales the emulator to the desktop. Defects found while making
that work on a phone:

- **Scaling was never enabled.** `useVncSession` sent `resize=scale`, but
  `vnc_lite.html` read a parameter called `scale`. Neither scaling nor remote
  resize was ever switched on; the parameter simply did nothing.
- **A fullscreen window is worse than a small one.** FreeJ2ME letterboxes the
  LCD inside its own frame and paints the leftover with the LCD component's
  white background, so maximising gives a white canvas with a small game in the
  middle. Sizing the window to the game's aspect ratio leaves no leftover area.
- **The AWT menu bar is inside the window.** Fitting the game to the full
  desktop height pushes the bottom `MENU_BAR_PX` rows off-screen, where the WM
  clamps and crops them.
- **FreeJ2ME undoes the fit.** It calls `setSize()` again when its settings are
  applied, so a fitter that keys off "what I last requested" applies once, gets
  overridden, and never retries. Compare the window's actual geometry.
- **A portrait phone saw a thin strip.** The desktop stayed 1280x720 landscape,
  so scaling it into a 9:19.5 viewport made the game tiny. The client now sends
  `resize=remote` (RFB SetDesktopSize, honoured by TigerVNC over RandR) so the
  desktop matches the canvas, and `fit-window.sh` refits the game to it.
- **Desktop size is server state shared by clients.** Resizing only for phones
  left the desktop portrait for the next desktop browser. Every client now
  asserts its own size, so the most recent connection wins.

## Known limits

- Single-node control plane; 50 concurrent streams per node (PRD KPI) needs a
  larger host and a real orchestrator.
- No GPU: software rendering only.
- The k6 suites measure the proxy/transport path, not pixel latency; a true
  input-to-pixel figure needs a browser per VU.
- Touch behaviour (TC-02) needs a physical iOS/Android device.
