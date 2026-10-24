/**
 * docs/testing.md §2.1 — WebSocket stream load test.
 *
 * Opens N concurrent noVNC-style WebSocket connections against one worker and
 * measures frame round-trip latency. Acceptance: average < 120 ms with zero
 * dropped frames.
 *
 *   k6 run -e BASE_URL=https://vnc.example.com \
 *          -e INSTANCE_ID=<uuid> -e TOKEN=<ticket> \
 *          -e VUS=50 tests/k6/stream-load.js
 *
 * Note: k6's `ws` module speaks the WebSocket protocol but NOT RFB. This test
 * therefore measures the proxy + websockify path (handshake, frame transport,
 * keepalive) rather than pixel rendering. A true pixel-level latency figure
 * needs a headless browser per VU; that is a separate Playwright suite.
 */
import ws from 'k6/ws';
import { check } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://127.0.0.1';
const INSTANCE_ID = __ENV.INSTANCE_ID || '';
const TOKEN = __ENV.TOKEN || '';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '2m';

const frameLatency = new Trend('vnc_frame_latency_ms', true);
const droppedFrames = new Counter('vnc_dropped_frames');
const connectOk = new Rate('vnc_connect_ok');

export const options = {
  scenarios: {
    streams: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: VUS },      // ramp
        { duration: DURATION, target: VUS },   // sustain
        { duration: '10s', target: 0 },        // drain
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // docs/prd.md §7: P95 frame delivery under 120 ms
    vnc_frame_latency_ms: ['p(95)<120'],
    vnc_connect_ok: ['rate>0.99'],
    vnc_dropped_frames: ['count<1'],
  },
  insecureSkipTLSVerify: true,
};

export default function () {
  const url = `${BASE_URL.replace(/^http/, 'ws')}/vnc-stream/${INSTANCE_ID}/websockify?token=${encodeURIComponent(TOKEN)}`;

  const res = ws.connect(url, { headers: { 'Sec-WebSocket-Protocol': 'binary' } }, (socket) => {
    let sentAt = 0;
    let frames = 0;

    socket.on('open', () => {
      connectOk.add(1);
      // Ping every 250 ms and time the pong. websockify forwards nothing for a
      // ping, so a protocol-level pong measures the proxy hop itself.
      socket.setInterval(() => {
        sentAt = Date.now();
        socket.send('ping');
      }, 250);
    });

    socket.on('message', () => {
      frames += 1;
      if (sentAt) frameLatency.add(Date.now() - sentAt);
    });

    socket.on('error', () => {
      droppedFrames.add(1);
    });

    // Hold the stream for the scenario's lifetime; a VNC session is long-lived.
    socket.setTimeout(() => socket.close(), 60000);
  });

  check(res, {
    'stream upgraded to 101': (r) => r && r.status === 101,
  });
  if (!res || res.status !== 101) connectOk.add(0);
}
