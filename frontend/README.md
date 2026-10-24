# CloudJava VNC — frontend

Next.js 14 (pages router) + TypeScript + Tailwind CSS dashboard for CloudJava VNC: rent an
isolated OpenJDK + TigerVNC + Openbox container and drive it in the browser through noVNC.

## Run

```bash
npm install
cp .env.local.example .env.local   # then edit if needed
npm run dev                        # http://localhost:3100
```

Production:

```bash
npm run build
npx next start -p 3100
```

Checks:

```bash
npx tsc --noEmit    # strict, no `any` without a comment, no @ts-ignore
npm run build
```

The build is fully offline: fonts are local CSS stacks (Inter / JetBrains Mono if installed,
otherwise the platform sans + mono), images are unoptimised, no remote requests at build time.
The UI renders without the backend — every screen has an empty, error and "control plane
unreachable" state, and nothing is fetched during prerender.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:4000` | Control-plane API base. Requests are sent with `credentials: 'include'` so the httpOnly `cj_session` cookie rides along. |
| `NEXT_PUBLIC_VNC_WS_BASE` | unset | Dev only. `ws://host:port` of a worker's websockify; the viewer then targets it directly instead of the nginx path. Leave unset in production. |

## Pages

| Route | What it does |
| --- | --- |
| `/` | Landing: pitch, the three plans (daily 15 000 IDR / 1 440 min, weekly 75 000 / 10 080, monthly 250 000 / 43 200), CTA to register. |
| `/login`, `/register` | Email + password with inline validation, disabled while submitting. |
| `/dashboard` | Protected. Instance cards: status pill, JDK, time remaining (1 s tick), CPU/RAM polled every 3 s from `/api/instances/:id/metrics`, Start / Stop / Restart / Reset / Delete, Launch. |
| `/instances/[id]` | The viewer: `RemoteViewer` + `VirtualGamepad`. |

## Why `vnc_lite.html` inside an iframe

`docs/onboarding.md` §3.1 makes this a hard rule: the player **must** be `vnc_lite.html` in an
iframe. The full noVNC UI (`vnc.html`) ships a sidebar, control bar and status chrome that break
the immersive "just the desktop" experience; `vnc_lite.html` is a canvas plus a one-line status
bar, so the dashboard can own the entire chrome (status, ping, fullscreen) around it.

The iframe is same-origin (`/novnc/vnc_lite.html`, served from `public/`), which is what makes the
mobile gamepad possible: it reaches into `iframe.contentWindow.rfb` and calls
`sendKey(keysym, code, down)`.

`public/novnc/vnc_lite.html` carries one local addition — `window.rfb = rfb;` after the RFB object
is constructed. Stock noVNC 1.5.0 declares `rfb` at module scope, so it is not reachable from
`iframe.contentWindow`; the gamepad needs that one line. The rest of the vendor tree is untouched.

## The token / ws-path flow

`GET /api/instances/:id/connect` returns four fields, and **two of them are different credentials**:

```json
{
  "wsPath": "/vnc-stream/<instanceId>/websockify",
  "token": "<short-lived HMAC stream ticket>",
  "expiresAt": "2026-10-24T12:00:00.000Z",
  "rfbPassword": "<RFB session password>"
}
```

* `token` authorises **the stream** at the nginx edge proxy. It travels inside the websocket path
  (`<wsPath>?token=…`), because `vnc_lite.html` appends the raw `path` string to `wss://<host>/`
  and the query string survives intact.
* `rfbPassword` authenticates **the RFB handshake** and is passed as the `password` query param.

Swapping them fails: a ticket as the RFB password gives "authentication failed", and the RFB
password in the websocket URL authorises nothing.

The iframe URL is built as:

```ts
const params = new URLSearchParams({
  host: window.location.host,
  path: `${connect.wsPath}?token=${encodeURIComponent(connect.token)}`,
  password: connect.rfbPassword,
  resize: 'scale',
  autoconnect: 'true',
});
```

No port is passed, so noVNC reuses the page's own port — 443 behind TLS, the dev port locally.
One caveat: `vnc_lite.html` defaults `port` to `window.location.port`, and `host` already contains
the port outside 443/80, so the viewer sends an empty `port=` when the page is on a non-default
port. Without that, noVNC would build `ws://127.0.0.1:3100:3100/...` and the WebSocket constructor
throws. On 443 nothing changes.

Neither credential is persisted: they exist only in the iframe `src`, which dies when the component
unmounts. Nothing is written to `localStorage`, `sessionStorage` or the dashboard URL.

### Dev: point the iframe straight at a worker

Set `NEXT_PUBLIC_VNC_WS_BASE=ws://127.0.0.1:6080` and the viewer targets that host/port with
`path=websockify`, dropping the token (there is no proxy to validate it). The RFB password still
comes from `/connect`. Handy when nginx is not running locally.

## Mobile gamepad

`VirtualGamepad` renders only for `pointer: coarse` and is toggleable. It sits in its own dock row
below the canvas, so a mis-tap can never land in the remote desktop. Buttons use
`touch-action: none`, `user-select: none` and `preventDefault()` on `touchstart`/`touchend` so taps
register as key transitions without scrolling, text selection or double-tap zoom (TC-02), and every
iframe access is guarded by a readiness check and `try/catch` because the document is
cross-document until `vnc_lite.html` finishes loading.

| Control | Key | Keysym |
| --- | --- | --- |
| D-pad | ArrowUp / ArrowLeft / ArrowRight / ArrowDown | `0xFF52` / `0xFF51` / `0xFF53` / `0xFF54` |
| A / B | KeyA / KeyS | `0x61` / `0x73` |
| Secondary | KeyZ / KeyX / Enter / Space | `0x7A` / `0x78` / `0xFF0D` / `0x20` |

## Layout

| Path | Role |
| --- | --- |
| `src/lib/api.ts` | Typed fetch client (`credentials: 'include'`, `ApiError` with `code`/`status`). |
| `src/lib/types.ts` | API types, incl. `ConnectInfo` with the two-credential comment. |
| `src/lib/plans.ts` | Plan fallback catalogue + IDR formatting. |
| `src/lib/metrics.ts` | Normalises `/metrics` (accepts flat or Docker-stats shapes). |
| `src/lib/vncBridge.ts` | Keysyms + `sendKeyToViewer()` into the noVNC iframe. |
| `src/hooks/useAuth.tsx` | `me()` on mount, login/register/logout, redirect for protected pages. |
| `src/hooks/usePolling.ts` | Interval fetch, no overlapping requests, pauses when the tab is hidden. |
| `src/components/RemoteViewer.tsx` | iframe + connect flow, overlays, header bar, fullscreen. |
| `src/components/VirtualGamepad.tsx` | Touch overlay. |
| `src/components/AppShell.tsx` | Header/nav shared by dashboard and viewer. |
