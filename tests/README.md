# Test suites

Two layers, deliberately separate:

| Suite | What it proves | Command |
| --- | --- | --- |
| `backend/scripts/integration-test.mjs` | TC-01: full container lifecycle in < 5 s, ports allocated and released, connect ticket valid | `cd backend && node scripts/integration-test.mjs` |
| `worker-node/verify-container.sh` | The container itself: non-root, cap-drop, loopback-only RFB, websockify handshake | `./worker-node/verify-container.sh <container> <vnc-pass>` |
| `tests/k6/stream-load.js` | 50 concurrent WebSocket streams, P95 frame latency < 120 ms | `k6 run ... tests/k6/stream-load.js` |
| `tests/k6/lifecycle-smoke.js` | Control-plane API under concurrent users | `k6 run ... tests/k6/lifecycle-smoke.js` |

## Why the lifecycle test uses the mock driver

`DOCKER_DRIVER=mock` simulates container create/start/stop/remove with realistic
latency and the same interface as the real driver. It makes TC-01 runnable in CI
with no Docker daemon, and it still exercises the parts that actually break:
port allocation, the provisioning timeout, rollback on failure, and the proxy
route table.

Set `MOCK_FAIL_PROVISIONING=true` to assert the rollback path: the instance must
end in `failed`, both ports must be released, and the next provisioning attempt
must succeed.

## Manual mobile verification (docs/testing.md TC-02)

Touch handling cannot be asserted from a headless browser. Run the stack, open
the viewer on a real iOS Safari and Android Chrome device, and confirm:

1. A tap registers as a mouse click in the remote desktop.
2. Gamepad buttons produce keydown/keyup (the sample `GameDemo` shows a key counter).
3. Pinch-zoom does not move the viewport while the gamepad is touched
   (`touch-action: none` is doing its job).
4. Rotating the device reflows the canvas without leaving black bands.
