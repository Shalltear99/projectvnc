import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { ConnectInfo } from '@/lib/types';
import { VirtualGamepad } from './VirtualGamepad';

type ViewerPhase = 'requesting' | 'loading' | 'connecting' | 'connected' | 'error';

interface RfbHandle {
  scaleViewport?: boolean;
  _rfbConnectionState?: string;
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

function describeError(error: unknown): string {
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

export function RemoteViewer({ instanceId }: { instanceId: string }): JSX.Element {
  const [phase, setPhase] = useState<ViewerPhase>('requesting');
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  /** Placeholder until the metrics stream exposes a real RTT sample. */
  const ping = '--';

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ------------------------------------------------------ token + src --- */
  useEffect(() => {
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
          setError('The VNC connection closed unexpectedly. The instance may have stopped or the ticket expired.');
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

  /* -------------------------------------------------------- fullscreen --- */
  useEffect(() => {
    const onChange = (): void => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(async (): Promise<void> => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current?.requestFullscreen();
      }
    } catch {
      // iOS Safari refuses non-video fullscreen; the layout is already 100dvh.
    }
  }, []);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const statusLabel: Record<ViewerPhase, string> = {
    requesting: 'Authorising',
    loading: 'Loading client',
    connecting: 'Connecting',
    connected: 'Connected',
    error: 'Disconnected',
  };

  const statusTone =
    phase === 'connected'
      ? 'bg-status-ok'
      : phase === 'error'
        ? 'bg-status-bad'
        : 'bg-status-warn animate-pulse-soft';

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col bg-black">
      {/* Header bar — docs/design.md section 1.1 */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-white/10 bg-surface-base px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={['h-2 w-2 rounded-full', statusTone].join(' ')} />
          <span className="text-[12px] font-medium text-slate-200">{statusLabel[phase]}</span>
        </div>

        <span className="hidden font-mono text-[11px] text-slate-500 sm:inline" title={instanceId}>
          {instanceId}
        </span>

        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5" title="Latency readout — wired to the metrics stream">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Ping</span>
            <span className="font-mono text-[11px] tabular-nums text-slate-300">{ping} ms</span>
          </span>

          {phase === 'error' ? (
            <button
              type="button"
              onClick={retry}
              className="rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 text-[12px] font-medium text-accent transition-colors hover:bg-accent/25"
            >
              Retry
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="grid h-7 w-7 place-items-center rounded-md border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            {fullscreen ? (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M4.5 1v3.5H1M7.5 1v3.5H11M4.5 11V7.5H1M7.5 11V7.5H11" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M1 4.5V1h3.5M11 4.5V1H7.5M1 7.5V11h3.5M11 7.5V11H7.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Canvas viewport */}
      <div className="viewer-surface relative min-h-0 flex-1">
        {src ? (
          <iframe
            key={attempt}
            ref={iframeRef}
            src={src}
            title="CloudJava VNC session"
            onLoad={handleIframeLoad}
            /*
             * Sandbox: vnc_lite.html is our own static asset and needs scripts
             * (noVNC is an ES-module app) plus same-origin (module imports and
             * the gamepad reaching window.rfb). It gets no top-navigation, no
             * popups and no downloads, so a compromised worker can only draw
             * pixels. The session cookie is httpOnly on the API origin and is
             * never exposed to this frame's scripts.
             */
            sandbox="allow-scripts allow-same-origin allow-forms"
            allow="clipboard-read; clipboard-write; fullscreen"
            className="absolute inset-0 h-full w-full"
          />
        ) : null}

        {phase !== 'connected' && phase !== 'error' ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-surface-base">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
            <div className="text-center">
              <p className="text-sm font-medium text-slate-200">{statusLabel[phase]}…</p>
              <p className="mt-1 font-mono text-[11px] text-slate-500">
                {phase === 'requesting'
                  ? 'GET /api/instances/:id/connect'
                  : phase === 'loading'
                    ? 'novnc/vnc_lite.html'
                    : 'wss handshake'}
              </p>
            </div>
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-base px-6">
            <div className="panel max-w-md p-5 text-center">
              <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full border border-status-bad/30 bg-status-bad/10">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-status-bad" />
              </div>
              <h2 className="text-sm font-semibold text-white">Stream unavailable</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{error}</p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-strong"
                >
                  Retry
                </button>
                <a
                  href="/dashboard"
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[13px] text-slate-300 transition-colors hover:bg-white/10"
                >
                  Back to instances
                </a>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <VirtualGamepad iframeRef={iframeRef} active={phase === 'connected'} />
    </div>
  );
}
