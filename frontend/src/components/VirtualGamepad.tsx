import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject, TouchEvent as ReactTouchEvent } from 'react';
import {
  ACTION_KEYS,
  DPAD_KEYS,
  SECONDARY_KEYS,
  isViewerReady,
  sendKeyToViewer,
  type GamepadKey,
} from '@/lib/vncBridge';

export interface VirtualGamepadProps {
  iframeRef: RefObject<HTMLIFrameElement>;
  /** False while the stream is still connecting — pad renders dimmed. */
  active: boolean;
}

/**
 * Mobile virtual gamepad (docs/design.md section 3).
 *
 * - Only rendered for coarse pointers (`pointer: coarse`), i.e. touch devices,
 *   and can be hidden with the toggle.
 * - Sits in its own dock row *below* the VNC surface so it never covers the
 *   canvas (a mis-tap on a translucent overlay would land in the desktop).
 * - Taps are translated to real key transitions inside the noVNC iframe via
 *   rfb.sendKey(); see lib/vncBridge.ts.
 * - touch-action:none / user-select:none / preventDefault keep the tap from
 *   turning into a scroll, a double-tap zoom or a text selection (TC-02).
 */
export function VirtualGamepad({ iframeRef, active }: VirtualGamepadProps): JSX.Element | null {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [visible, setVisible] = useState(true);
  const [pressed, setPressed] = useState<GamepadKey | null>(null);
  const [ready, setReady] = useState(false);
  /** Touch identifier per key so a multi-touch release doesn't stick a key down. */
  const activeTouches = useRef<Map<number, GamepadKey>>(new Map());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(pointer: coarse)');
    const apply = (): void => setIsCoarsePointer(query.matches);
    apply();
    // Safari < 14 only supports addListener.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', apply);
      return () => query.removeEventListener('change', apply);
    }
    query.addListener(apply);
    return () => query.removeListener(apply);
  }, []);

  // Poll readiness: the RFB instance appears only after vnc_lite.html loads.
  useEffect(() => {
    if (!isCoarsePointer || !visible) return;
    const timer = setInterval(() => setReady(isViewerReady(iframeRef.current)), 1000);
    setReady(isViewerReady(iframeRef.current));
    return () => clearInterval(timer);
  }, [isCoarsePointer, visible, iframeRef, active]);

  const press = useCallback(
    (key: GamepadKey) => {
      if (!active) return;
      setPressed(key);
      sendKeyToViewer(iframeRef.current, key, true);
    },
    [active, iframeRef],
  );

  const release = useCallback(
    (key: GamepadKey) => {
      setPressed((current) => (current === key ? null : current));
      sendKeyToViewer(iframeRef.current, key, false);
    },
    [iframeRef],
  );

  const onTouchStart = (key: GamepadKey) => (event: ReactTouchEvent<HTMLButtonElement>) => {
    // Must happen synchronously: iOS only honours preventDefault here.
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      if (activeTouches.current.has(touch.identifier)) continue;
      activeTouches.current.set(touch.identifier, key);
      press(key);
    }
  };

  const onTouchEnd = (event: ReactTouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      const key = activeTouches.current.get(touch.identifier);
      if (key === undefined) continue;
      activeTouches.current.delete(touch.identifier);
      release(key);
    }
  };

  const onTouchCancel = (event: ReactTouchEvent<HTMLButtonElement>) => {
    for (const touch of Array.from(event.changedTouches)) {
      const key = activeTouches.current.get(touch.identifier);
      if (key === undefined) continue;
      activeTouches.current.delete(touch.identifier);
      release(key);
    }
  };

  if (!isCoarsePointer) {
    return null;
  }

  const padButton = (spec: (typeof DPAD_KEYS)[number], extra: string): JSX.Element => {
    const isDown = pressed === spec.key;
    return (
      <button
        key={spec.key}
        type="button"
        aria-label={spec.ariaLabel}
        onTouchStart={onTouchStart(spec.key)}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onContextMenu={(event) => event.preventDefault()}
        className={[
          'gamepad-key grid select-none place-items-center rounded-xl border text-slate-100',
          'transition-colors duration-75',
          isDown ? 'border-accent bg-accent/40' : 'border-white/15 bg-white/10',
          !active ? 'opacity-40' : '',
          extra,
        ].join(' ')}
      >
        <span aria-hidden="true" className="text-base leading-none">
          {spec.glyph}
        </span>
      </button>
    );
  };

  if (!visible) {
    return (
      <div className="gamepad-surface flex h-10 shrink-0 items-center justify-center border-t border-white/5 bg-surface-base">
        <button
          type="button"
          onClick={() => setVisible(true)}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-wider text-slate-400"
        >
          Show gamepad
        </button>
      </div>
    );
  }

  return (
    <div className="gamepad-surface flex shrink-0 items-center justify-between gap-3 border-t border-white/5 bg-surface-base/95 px-3 py-3">
      {/* Left thumb: D-pad */}
      <div className="grid grid-cols-3 grid-rows-3 gap-1.5" role="group" aria-label="Directional pad">
        <span aria-hidden="true" />
        {padButton(DPAD_KEYS[0], 'h-12 w-12')}
        <span aria-hidden="true" />
        {padButton(DPAD_KEYS[1], 'h-12 w-12')}
        <span aria-hidden="true" className="grid place-items-center">
          <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
        </span>
        {padButton(DPAD_KEYS[2], 'h-12 w-12')}
        <span aria-hidden="true" />
        {padButton(DPAD_KEYS[3], 'h-12 w-12')}
        <span aria-hidden="true" />
      </div>

      {/* Middle: secondary keys + state */}
      <div className="flex flex-1 flex-col items-center gap-2">
        <div className="flex items-center gap-1.5">
          {SECONDARY_KEYS.map((spec) => (
            <button
              key={spec.key}
              type="button"
              aria-label={spec.ariaLabel}
              onTouchStart={onTouchStart(spec.key)}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchCancel}
              onContextMenu={(event) => event.preventDefault()}
              className={[
                'gamepad-key grid h-8 min-w-[2rem] place-items-center rounded-lg border px-2 font-mono text-[11px]',
                pressed === spec.key
                  ? 'border-accent bg-accent/40 text-white'
                  : 'border-white/10 bg-white/5 text-slate-300',
                !active ? 'opacity-40' : '',
              ].join(' ')}
            >
              {spec.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
          <span
            aria-hidden="true"
            className={[
              'h-1.5 w-1.5 rounded-full',
              ready && active ? 'bg-status-ok' : 'bg-status-warn animate-pulse-soft',
            ].join(' ')}
          />
          <span>{ready && active ? 'Keys live' : 'Waiting for stream'}</span>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="rounded px-1.5 py-0.5 text-slate-500 underline decoration-dotted underline-offset-2"
          >
            Hide
          </button>
        </div>
      </div>

      {/* Right thumb: A / B */}
      <div className="flex items-center gap-2" role="group" aria-label="Action buttons">
        {ACTION_KEYS.map((spec, index) => {
          const isDown = pressed === spec.key;
          return (
            <button
              key={spec.key}
              type="button"
              aria-label={spec.ariaLabel}
              onTouchStart={onTouchStart(spec.key)}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchCancel}
              onContextMenu={(event) => event.preventDefault()}
              className={[
                'gamepad-key grid select-none place-items-center rounded-full border font-semibold',
                index === 0 ? 'h-16 w-16 text-lg' : 'h-14 w-14 translate-y-2 text-base',
                isDown
                  ? 'border-accent bg-accent/50 text-white'
                  : 'border-white/15 bg-white/10 text-slate-100',
                !active ? 'opacity-40' : '',
              ].join(' ')}
            >
              {spec.glyph}
            </button>
          );
        })}
      </div>
    </div>
  );
}
