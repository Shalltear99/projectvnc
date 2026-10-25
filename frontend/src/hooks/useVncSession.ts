import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { ConnectInfo } from '@/lib/types';

export type ViewerPhase = 'requesting' | 'loading' | 'connecting' | 'connected' | 'error';

export interface VncSession {
  phase: ViewerPhase;
  error: string | null;
  src: string | null;
  attempt: number;
  iframeRef: React.RefObject<HTMLIFrameElement>;
  /** Bumped by `refresh()`; remounting the iframe is how noVNC is restarted. */
  retry: () => void;
  connected: boolean;
}

interface RfbHandle {
  scaleViewport?: boolean;
  resizeSession?: boolean;
}

interface ViewerWindow extends Window {
  rfb?: RfbHandle;
}

const STATUS_POLL_MS = 900;

/**
 * Build the vnc_lite.html URL.
 *
 * Two different credentials are involved and they must not be swapped:
 *  - `token` (short-lived HMAC ticket) authorises the *stream* at the nginx
 *    edge proxy, so it rides inside the websocket path as `?token=…`;
 *  - `rfbPassword` authenticates the *RFB handshake* and is the `password` param.
 *
 * `path` keeps its query string on purpose: vnc_lite.html appends the raw path
 * string to `wss://<host>/`, so the ticket reaches nginx intact.
 * No `port` param is set: noVNC then reuses the page's own port, which is 443
 * behind TLS and the dev port locally.
 *
 * Nothing here is persisted: the URL lives only in the iframe `src` and dies
 * with the component. The dashboard URL bar never carries either credential.
 */
export function buildViewerSrc(info: ConnectInfo): string {
  const devBase = process.env.NEXT_PUBLIC_VNC_WS_BASE;

  // Dev escape hatch: talk to a worker's websockify directly, bypassing nginx
  // (no ticket validation there, so the token is dropped).
  if (devBase) {
    let host = window.location.host;
    let port = '';
    try {
      const parsed = new URL(devBase);
      host = parsed.hostname;
      port = parsed.port;
    } catch {
      // Ignore a malformed override and fall back to the proxy form.
    }
    const devParams = new URLSearchParams({
      host,
      ...(port ? { port } : {}),
      path: 'websockify',
      password: info.rfbPassword,
      resize: 'scale',
      autoconnect: 'true',
    });
    return `/novnc/vnc_lite.html?${devParams.toString()}`;
  }

  const params = new URLSearchParams({
    host: window.location.host,
    // vnc_lite.html builds its URL as `'/' + path`, so the leading slash must be
    // stripped here or the request becomes `//vnc-stream/...`. nginx tolerates
    // that, but the raw path then fails the API's stream-token check and the
    // user sees an auth failure instead of a desktop.
    path: `${info.wsPath.replace(/^\/+/, '')}?token=${encodeURIComponent(info.token)}`,
    password: info.rfbPassword,
    resize: 'scale',
    autoconnect: 'true',
  });

  /*
   * vnc_lite.html defaults `port` to `window.location.port` and only appends it
   * when truthy. Because `host` is `window.location.host` (which already carries
   * the port outside 443/80), that default would produce a duplicated authority
   * — `ws://127.0.0.1:3100:3100/...` — and the WebSocket constructor throws.
   * An explicitly empty port keeps the "never hardcode a port" behaviour and is
   * a no-op on the default port, where nothing would be appended anyway.
   */
  if (window.location.port) {
    params.set('port', '');
  }

  return `/novnc/vnc_lite.html?${params.toString()}`;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) {
      return 'Cannot reach the control plane. Check that the API is running, then retry.';
    }
    if (error.status === 409) {
      return 'This instance is not running. Start it from the dashboard, then launch again.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Could not start the stream.';
}

/**
 * Owns the noVNC session lifecycle: ticket fetch, iframe src, handshake
 * watchdog and status mirroring.
 *
 * Extracted so the redesigned workspace and the legacy viewer share ONE
 * implementation — a second copy of the ticket/RFB-credential logic is exactly
 * the kind of duplication that produces two different auth bugs.
 */
export function useVncSession(instanceId: string | null): VncSession {
  const [phase, setPhase] = useState<ViewerPhase>('requesting');
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  /* ------------------------------------------------------ token + src --- */
  useEffect(() => {
    if (!instanceId) return;
    let cancelled = false;
    setPhase('requesting');
    setError(null);
    setSrc(null);

    api
      .connect(instanceId)
      .then((info) => {
        if (cancelled) return;
        setSrc(buildViewerSrc(info));
        setPhase('loading');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(describeError(caught));
        setPhase('error');
      });

    return () => {
      cancelled = true;
    };
  }, [instanceId, attempt]);

  /* -------------------------------------------------- iframe readiness --- */
  const handleIframeLoad = useCallback(() => {
    setPhase((current) => (current === 'error' ? current : 'connecting'));
  }, []);

  useEffect(() => {
    if (!src) return;
    const frame = iframeRef.current;
    if (!frame) return;
    frame.addEventListener('load', handleIframeLoad);
    return () => frame.removeEventListener('load', handleIframeLoad);
  }, [src, handleIframeLoad]);

  /**
   * Watchdog: a websocket upgrade that never completes (proxy down, ticket
   * rejected silently) would otherwise leave the overlay spinning forever.
   */
  useEffect(() => {
    if (phase !== 'connecting') return;
    const timer = setTimeout(() => {
      setError(
        'The stream did not come up in time. The worker or the nginx websocket proxy may be down.',
      );
      setPhase('error');
    }, 25000);
    return () => clearTimeout(timer);
  }, [phase]);

  /**
   * vnc_lite.html owns the RFB lifecycle; the dashboard only mirrors it by
   * reading the page's own #status line (same origin, so this is allowed).
   * No fabricated state: if the line cannot be read, we stay on "connecting".
   */
  useEffect(() => {
    if (!src) return;
    if (phase !== 'connecting' && phase !== 'connected') return;

    const timer = setInterval(() => {
      const frame = iframeRef.current;
      try {
        const doc = frame?.contentDocument;
        const text = doc?.getElementById('status')?.textContent ?? '';
        if (text.startsWith('Connected')) {
          setPhase('connected');
          // Stock vnc_lite.html only scales when ?scale=true is honoured; force
          // it here so the canvas fits a 390 px viewport as well as a desktop.
          const win = frame?.contentWindow as ViewerWindow | null;
          if (win?.rfb) {
            try {
              win.rfb.scaleViewport = true;
            } catch {
              /* noVNC may reject the change mid-handshake; harmless. */
            }
          }
        } else if (text.includes('Something went wrong')) {
          setError(
            'The VNC connection closed unexpectedly. The instance may have stopped or the ticket expired.',
          );
          setPhase('error');
        } else if (text.startsWith('Disconnected')) {
          setError('Disconnected from the instance.');
          setPhase('error');
        }
      } catch {
        // Cross-document access before load completes — try again next tick.
      }
    }, STATUS_POLL_MS);

    return () => clearInterval(timer);
  }, [src, phase]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return {
    phase,
    error,
    src,
    attempt,
    iframeRef,
    retry,
    connected: phase === 'connected',
  };
}

export const VIEWER_STATUS_LABEL: Record<ViewerPhase, string> = {
  requesting: 'Authorising',
  loading: 'Loading client',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Disconnected',
};
