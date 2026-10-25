import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { VncSession } from '@/hooks/useVncSession';
import { VIEWER_STATUS_LABEL } from '@/hooks/useVncSession';

/**
 * Embedded noVNC canvas.
 *
 * Owns the three overlay actions (fullscreen / refresh / screenshot) and the
 * connection state surfaces. The RFB lifecycle itself belongs to
 * `useVncSession`; this component only draws and dispatches.
 *
 * Overlays are `glass` (backdrop-blur) and anchored top-right so they never sit
 * over the desktop's own UI, which on a Java app is usually a toolbar or a game
 * HUD in the corners.
 */
export interface VNCViewerCanvasProps {
  session: VncSession;
  /** Floating controls rendered INSIDE the canvas wrapper (mobile D-pad etc). */
  children?: ReactNode;
  className?: string;
}

export function VNCViewerCanvas({ session, children, className = '' }: VNCViewerCanvasProps): JSX.Element {
  const { phase, error, src, attempt, iframeRef, retry, connected } = session;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /* ---------------------------------------------------------- fullscreen --- */
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
        await wrapRef.current?.requestFullscreen();
      }
    } catch {
      // iOS Safari refuses fullscreen on non-video elements. The layout is
      // already 100dvh, so this is a cosmetic loss, not a broken control.
      setNotice('Fullscreen is not available in this browser');
    }
  }, []);

  /* ------------------------------------------------------- embed chrome --- */
  /**
   * Strip vnc_lite.html's own top bar.
   *
   * It duplicates our overlay controls (fullscreen, clipboard) and its light
   * strip sat underneath them, which both looked broken and broke the emerald
   * ring along the top edge. PRD FR-2.1 asks for the native control bars to be
   * stripped for an immersive canvas, so hide it here.
   *
   * `#status` lives inside that bar and stays in the DOM — `display:none` does
   * not remove textContent, so the connection mirror in useVncSession keeps
   * working. The "Send CtrlAltDel" affordance is re-provided in the overlay,
   * because hiding the bar would otherwise remove the only way to send it.
   */
  const stripChrome = useCallback((): boolean => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return false;
    if (doc.getElementById('cj-embed-style')) return true;
    /*
     * Wait for the real document. The iframe exists (and fires `load`) while it
     * is still about:blank, and its document is replaced when the viewer URL
     * commits — injecting into the placeholder silently does nothing.
     */
    if (!doc.getElementById('screen')) return false;
    const style = doc.createElement('style');
    style.id = 'cj-embed-style';
    style.textContent = [
      '#top_bar{display:none!important}',
      'html,body{margin:0;padding:0;overflow:hidden;background:#000}',
      '#screen{position:fixed;inset:0;width:100%!important;height:100%!important}',
    ].join('');
    doc.head?.appendChild(style);
    return true;
  }, [iframeRef]);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;

    let injected = false;
    const attemptInject = (): void => {
      if (injected) return;
      injected = stripChrome();
    };

    const onLoad = (): void => attemptInject();
    frame.addEventListener('load', onLoad);
    // The viewer's document commits asynchronously, so poll briefly rather than
    // trusting a single load event.
    const timer = setInterval(() => {
      attemptInject();
      if (injected) clearInterval(timer);
    }, 200);
    const giveUp = setTimeout(() => clearInterval(timer), 20000);

    attemptInject();
    return () => {
      clearInterval(timer);
      clearTimeout(giveUp);
      frame.removeEventListener('load', onLoad);
    };
  }, [iframeRef, stripChrome, attempt, src]);

  /**
   * Send Ctrl+Alt+Del through the embedded RFB session.
   *
   * Replaces the button we hide with #top_bar. noVNC exposes the live RFB
   * instance as `window.rfb` inside vnc_lite.html; if the stream is not up yet
   * the call is refused with a visible notice rather than silently doing
   * nothing.
   */
  const sendCtrlAltDel = useCallback((): void => {
    type RfbLike = { sendCtrlAltDel?: () => void };
    const frame = iframeRef.current;
    const rfb = (frame?.contentWindow as (Window & { rfb?: RfbLike }) | null)?.rfb;
    if (!rfb || typeof rfb.sendCtrlAltDel !== 'function') {
      setNotice('Desktop is not connected yet');
      return;
    }
    try {
      rfb.sendCtrlAltDel();
      setNotice('Ctrl+Alt+Del sent');
    } catch {
      setNotice('Could not send the key combination');
    }
  }, [iframeRef]);

  /* ---------------------------------------------------------- screenshot --- */
  /**
   * Grab the noVNC canvas as PNG.
   *
   * The canvas lives in a same-origin iframe, so `toDataURL` is allowed. It
   * throws on a tainted canvas (which would mean something cross-origin was
   * drawn into it) — that is reported, never silently swallowed, because a
   * "Screenshot" button that saves a blank file is worse than an error.
   */
  const takeScreenshot = useCallback((): void => {
    const frame = iframeRef.current;
    try {
      const canvas = frame?.contentDocument?.querySelector('canvas');
      if (!canvas) {
        setNotice('No canvas yet — connect first');
        return;
      }
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.href = url;
      link.download = `cloudjava-${stamp}.png`;
      link.click();
      setNotice('Screenshot saved');
    } catch {
      setNotice('Screenshot blocked by the browser');
    }
  }, [iframeRef]);

  // Auto-dismiss the transient toast.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2200);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div
      ref={wrapRef}
      className={[
        'relative min-h-0 overflow-hidden rounded-xl bg-black transition-shadow',
        connected ? 'ring-1 ring-neon/30 shadow-glow-emerald' : 'ring-1 ring-white/10',
        className,
      ].join(' ')}
    >
      {src ? (
        <iframe
          key={attempt}
          ref={iframeRef}
          src={src}
          title="CloudJava VNC session"
          /*
           * Sandbox: vnc_lite.html is our own static asset and needs scripts
           * (noVNC is an ES-module app) plus same-origin (module imports and the
           * gamepad reaching window.rfb). It gets no top-navigation, no popups
           * and no downloads, so a compromised worker can only draw pixels. The
           * session cookie is httpOnly on the API origin and is never exposed to
           * this frame's scripts.
           */
          sandbox="allow-scripts allow-same-origin allow-forms"
          allow="clipboard-read; clipboard-write; fullscreen"
          className="vnc-canvas-fit absolute inset-0 h-full w-full border-0 bg-black"
        />
      ) : null}

      {/* ------------------------------------------------ overlay cluster --- */}
      <div className="absolute right-2 top-2 z-20 flex items-center gap-1.5">
        <button
          type="button"
          onClick={takeScreenshot}
          className="overlay-btn w-auto px-2 font-mono text-[10px] tracking-wide"
          title="Save the canvas as a PNG"
          aria-label="Take screenshot"
        >
          <svg width="12" height="12" viewBox="0 0 14 12" aria-hidden="true">
            <path
              d="M5 2.5 5.8 1h2.4l.8 1.5H12a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h3Z"
              stroke="currentColor"
              strokeWidth="1.1"
              fill="none"
              strokeLinejoin="round"
            />
            <circle cx="7" cy="6.5" r="2.1" stroke="currentColor" strokeWidth="1.1" fill="none" />
          </svg>
          <span>SS</span>
        </button>
        <button
          type="button"
          onClick={retry}
          className="overlay-btn"
          title="Reconnect the stream"
          aria-label="Refresh stream"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M12 7a5 5 0 1 1-1.6-3.7M12 1.5V4h-2.5"
              stroke="currentColor"
              strokeWidth="1.3"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={sendCtrlAltDel}
          className="overlay-btn w-auto px-2 font-mono text-[10px] tracking-wide"
          title="Send Ctrl+Alt+Del to the desktop"
          aria-label="Send Ctrl Alt Del"
        >
          CAD
        </button>
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          className="overlay-btn"
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
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

      {notice ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
          <span className="glass rounded-md px-2.5 py-1 text-[11px] text-slate-200">{notice}</span>
        </div>
      ) : null}

      {/* -------------------------------------------------- connection state --- */}
      {phase !== 'connected' && phase !== 'error' ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-cyber-bg">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon/25 border-t-neon" />
          <div className="text-center">
            <p className="text-[13px] font-medium text-slate-200">{VIEWER_STATUS_LABEL[phase]}…</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">
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
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-cyber-bg px-5">
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full border border-status-bad/30 bg-status-bad/10">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-status-bad" />
            </div>
            <h2 className="text-[13px] font-semibold text-white">Stream unavailable</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-slate-400">{error}</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={retry}
                className="rounded-lg bg-electric px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-electric-deep"
              >
                Reconnect
              </button>
              <a
                href="/dashboard"
                className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-1.5 text-[12px] text-slate-300 transition-colors hover:bg-white/10"
              >
                Instances
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {children}
    </div>
  );
}
