# worker-node — CloudJava VNC worker container

One container = one user session. Non-root (uid 1000), `--cap-drop=ALL`,
no-new-privileges, cgroup-capped, VNC bound to loopback.

## Process tree (supervisord)

```
Xtigervnc :1 (127.0.0.1:5901, VncAuth)   <- RFB, loopback only
  └── openbox (no decorations, no panel)
  └── run-game.sh -> /opt/game/start.sh | *.jar via FreeJ2ME
websockify 0.0.0.0:6080 -> 127.0.0.1:5901  <- only exposed port
```

## Build

```bash
docker build -t cloudjava-worker:latest .
# skip the J2ME emulator to shave ~40 MB
docker build --build-arg INSTALL_FREEJ2ME=false -t cloudjava-worker:latest .
```

## Run (as the control plane does)

```bash
docker run -d --name cj-test \
  --user 1000:1000 --cap-drop=ALL --security-opt no-new-privileges \
  --pids-limit 256 --memory 1g --cpus 1.0 \
  -e VNC_PASSWORD=testpass123 -e JAVA_ENV_VERSION=17 \
  -p 127.0.0.1:6081:6080 \
  -v "$PWD/game:/opt/game" \
  cloudjava-worker:latest
```

Open `http://127.0.0.1:6081/vnc_lite.html` (debug only) or point noVNC at
`ws://127.0.0.1:6081/websockify`.

## Env contract

| Var | Default | Meaning |
| --- | --- | --- |
| `VNC_PASSWORD` | *(required)* | RFB password, >= 6 chars, injected per instance |
| `JAVA_ENV_VERSION` | `17` | `8`, `11`, `17`, `21` |
| `SCREEN_W` / `SCREEN_H` | `1280` / `720` | virtual display geometry |
| `WS_PORT` | `6080` | websockify listen port inside the container |
| `VNC_PORT` | `5901` | RFB port, loopback only |

## Notes

* `VNC_PASSWORD` is required — the entrypoint exits `64` rather than expose an
  unauthenticated desktop.
* `-BlacklistThreshold 10000` prevents a browser's burst of subrequests from
  locking a legitimate user out (the default of 5 is self-destructive behind a
  proxy).
* Healthcheck probes websockify's static page, not the RFB port, so it never
  accrues failed-auth strikes.
* `/opt/game` should be bind-mounted; the image upgrade path must not delete
  user saves. **Treat it as read-only from the container's point of view**: a
  bind mount carries the host's uid/gid, which will not match 1000:1000, so a
  launcher that compiles or writes next to its sources fails with
  `Permission denied` and leaves an empty desktop. Compile into `$HOME/build`
  (see `sample/start.sh`). If you need a writable game dir, use a named volume
  and `chown 1000:1000` it once from a privileged helper.
