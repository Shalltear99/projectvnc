import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject, TouchEvent as ReactTouchEvent } from 'react';
import {
  ACTION_KEYS,
  DPAD_KEYS,
  HOTKEY_KEYS,
  isViewerReady,
  sendKeyToViewer,
  type GamepadKey,
} from '@/lib/vncBridge';

/**
 * Floating touch controls drawn OVER the VNC canvas (mobile only).
 *
 * Differences from the older docked `VirtualGamepad`:
 *  - it floats, per the redesign spec, so the desktop keeps the full viewport;
 *  - it is collapsible, because a translucent overlay over a game HUD is
 *    sometimes worse than no overlay;
 *  - it carries the 1-4 quick-skill bar.
 *
 * The safety rules are unchanged: `touch-action: none` plus `preventDefault` on
 * touchstart stop a tap becoming a scroll, a double-tap zoom or a long-press
 * text selection (docs/testing.md TC-02), and every touch is tracked by
 * identifier so a multi-touch release cannot leave a key stuck down.
 */
export interface MobileControlsProps {
  iframeRef: RefObject<HTMLIFrameElement>;
  active: boolean;
}

export function MobileControls({ iframeRef, active }: MobileControlsProps): JSX.Element | null {
  const [isTouch, setIsTouch] = useState(false);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [pressed, setPressed] = useState<GamepadKey | null>(null);
  const touches = useRef<Map<number, GamepadKey>>(new Map());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(pointer: coarse)');
    const apply = (): void => setIsTouch(query.matches);
    apply();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', apply);
      return () => query.removeEventListener('change', apply);
    }
    query.addListener(apply);
    return () => query.removeListener(apply);
  }, []);

  useEffect(() => {
    if (!isTouch || !visible) return;
    const timer = setInterval(() => setReady(isViewerReady(iframeRef.current)), 1000);
    setReady(isViewerReady(iframeRef.current));
    return () => clearInterval(timer);
  }, [isTouch, visible, iframeRef, active]);

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
    // Must run synchronously: iOS only honours preventDefault at this point.
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      if (touches.current.has(touch.identifier)) continue;
      touches.current.set(touch.identifier, key);
      press(key);
    }
  };

  const onTouchEnd = (event: ReactTouchEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      const key = touches.current.get(touch.identifier);
      if (key === undefined) continue;
      touches.current.delete(touch.identifier);
      release(key);
    }
  };

  const onTouchCancel = (event: ReactTouchEvent<HTMLButtonElement>): void => {
    for (const touch of Array.from(event.changedTouches)) {
      const key = touches.current.get(touch.identifier);
      if (key === undefined) continue;
      touches.current.delete(touch.identifier);
      release(key);
    }
  };

  if (!isTouch) return null;

  const keyProps = (key: GamepadKey) => ({
    onTouchStart: onTouchStart(key),
    onTouchEnd,
    onTouchCancel,
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
  });

  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        className="glass absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-300"
      >
        Show controls
      </button>
    );
  }

  return (
    <>
      {/* ------------------------------------------------------------- D-pad --- */}
      <div
        className="absolute bottom-3 left-3 z-20 grid grid-cols-3 grid-rows-3 gap-1"
        role="group"
        aria-label="Directional pad"
        style={{ touchAction: 'none' }}
      >
        <span aria-hidden="true" />
        <button
          type="button"
          aria-label={DPAD_KEYS[0].ariaLabel}
          {...keyProps(DPAD_KEYS[0].key)}
          className={[
            'gamepad-key grid h-11 w-11 place-items-center rounded-lg border text-slate-100 backdrop-blur-md',
            pressed === DPAD_KEYS[0].key ? 'border-neon bg-neon/40' : 'border-white/15 bg-black/50',
            !active ? 'opacity-40' : '',
          ].join(' ')}
        >
          <span aria-hidden="true" className="text-sm leading-none">{DPAD_KEYS[0].glyph}</span>
        </button>
        <span aria-hidden="true" />

        <button
          type="button"
          aria-label={DPAD_KEYS[1].ariaLabel}
          {...keyProps(DPAD_KEYS[1].key)}
          className={[
            'gamepad-key grid h-11 w-11 place-items-center rounded-lg border text-slate-100 backdrop-blur-md',
            pressed === DPAD_KEYS[1].key ? 'border-neon bg-neon/40' : 'border-white/15 bg-black/50',
            !active ? 'opacity-40' : '',
          ].join(' ')}
        >
          <span aria-hidden="true" className="text-sm leading-none">{DPAD_KEYS[1].glyph}</span>
        </button>
        <button
          type="button"
          aria-label="Hide controls"
          onClick={() => setVisible(false)}
          className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 bg-black/40 text-[9px] uppercase text-slate-500 backdrop-blur-md"
        >
          Hide
        </button>
        <button
          type="button"
          aria-label={DPAD_KEYS[2].ariaLabel}
          {...keyProps(DPAD_KEYS[2].key)}
          className={[
            'gamepad-key grid h-11 w-11 place-items-center rounded-lg border text-slate-100 backdrop-blur-md',
            pressed === DPAD_KEYS[2].key ? 'border-neon bg-neon/40' : 'border-white/15 bg-black/50',
            !active ? 'opacity-40' : '',
          ].join(' ')}
        >
          <span aria-hidden="true" className="text-sm leading-none">{DPAD_KEYS[2].glyph}</span>
        </button>

        <span aria-hidden="true" />
        <button
          type="button"
          aria-label={DPAD_KEYS[3].ariaLabel}
          {...keyProps(DPAD_KEYS[3].key)}
          className={[
            'gamepad-key grid h-11 w-11 place-items-center rounded-lg border text-slate-100 backdrop-blur-md',
            pressed === DPAD_KEYS[3].key ? 'border-neon bg-neon/40' : 'border-white/15 bg-black/50',
            !active ? 'opacity-40' : '',
          ].join(' ')}
        >
          <span aria-hidden="true" className="text-sm leading-none">{DPAD_KEYS[3].glyph}</span>
        </button>
        <span aria-hidden="true" />
      </div>

      {/* --------------------------------------- quick-skill bar + A/B keys --- */}
      <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5" role="group" aria-label="Quick skills">
          {HOTKEY_KEYS.map((spec) => (
            <button
              key={spec.key}
              type="button"
              aria-label={spec.ariaLabel}
              {...keyProps(spec.key)}
              className={[
                'gamepad-key grid h-9 w-9 place-items-center rounded-lg border font-mono text-[12px] backdrop-blur-md',
                pressed === spec.key ? 'border-neon bg-neon/40 text-white' : 'border-white/15 bg-black/50 text-slate-200',
                !active ? 'opacity-40' : '',
              ].join(' ')}
            >
              {spec.glyph}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2" role="group" aria-label="Action buttons">
          {ACTION_KEYS.map((spec, index) => (
            <button
              key={spec.key}
              type="button"
              aria-label={spec.ariaLabel}
              {...keyProps(spec.key)}
              className={[
                'gamepad-key grid select-none place-items-center rounded-full border font-semibold backdrop-blur-md',
                index === 0 ? 'h-14 w-14 text-base' : 'h-12 w-12 text-sm',
                pressed === spec.key ? 'border-neon bg-neon/50 text-white' : 'border-white/15 bg-black/50 text-slate-100',
                !active ? 'opacity-40' : '',
              ].join(' ')}
            >
              {spec.glyph}
            </button>
          ))}
        </div>

        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-500">
          <span
            aria-hidden="true"
            className={['h-1.5 w-1.5 rounded-full', ready && active ? 'bg-neon' : 'bg-status-warn animate-pulse-soft'].join(' ')}
          />
          {ready && active ? 'Keys live' : 'Waiting'}
        </span>
      </div>
    </>
  );
}
