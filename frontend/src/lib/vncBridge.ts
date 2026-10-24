/**
 * Bridge from the dashboard's virtual gamepad to noVNC running inside the
 * vnc_lite.html iframe.
 *
 * noVNC's RFB object exposes `sendKey(keysym, code, down)`, where `keysym` is an
 * X11 keysym and `code` is a DOM KeyboardEvent.code (noVNC maps the code to an
 * Xt scancode internally, so it must be a real code string such as "KeyZ").
 *
 * Everything here is defensive on purpose: the iframe is a separate document
 * that is cross-document until vnc_lite.html finishes loading, and its RFB
 * instance only exists after the page script ran. Any access can throw a
 * SecurityError or return undefined, so every path is wrapped in try/catch and
 * a readiness check, and failures are reported as `false` rather than thrown
 * into a touch handler (an exception there would abort the event and can leave
 * the page in a weird scroll state on iOS).
 */

/** Minimal shape of the noVNC RFB object that this bridge relies on. */
interface RfbLike {
  sendKey: (keysym: number, code: string, down?: boolean) => void;
  /** Internal connection state: '', 'connecting', 'connected', 'disconnected'. */
  _rfbConnectionState?: string;
}

interface ViewerWindow extends Window {
  rfb?: RfbLike;
}

/** X11 keysyms used by the gamepad (see docs/design.md section 3). */
export const KEYSYMS = {
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Enter: 0xff0d,
  Space: 0x20,
  KeyZ: 0x7a,
  KeyX: 0x78,
  KeyA: 0x61,
  KeyS: 0x73,
} as const;

export type GamepadKey = keyof typeof KEYSYMS;

export interface GamepadKeySpec {
  key: GamepadKey;
  label: string;
  /** Short glyph or letter rendered in the button. */
  glyph: string;
  ariaLabel: string;
}

/** D-pad arrows, in visual order. */
export const DPAD_KEYS: readonly GamepadKeySpec[] = [
  { key: 'ArrowUp', label: 'Up', glyph: '▲', ariaLabel: 'Move up' },
  { key: 'ArrowLeft', label: 'Left', glyph: '◀', ariaLabel: 'Move left' },
  { key: 'ArrowRight', label: 'Right', glyph: '▶', ariaLabel: 'Move right' },
  { key: 'ArrowDown', label: 'Down', glyph: '▼', ariaLabel: 'Move down' },
];

/** Primary action buttons (right thumb). */
export const ACTION_KEYS: readonly GamepadKeySpec[] = [
  { key: 'KeyA', label: 'A', glyph: 'A', ariaLabel: 'Action A' },
  { key: 'KeyS', label: 'B', glyph: 'B', ariaLabel: 'Action B' },
];

/** Secondary row: the extra keysyms requested by the spec. */
export const SECONDARY_KEYS: readonly GamepadKeySpec[] = [
  { key: 'KeyZ', label: 'Z', glyph: 'Z', ariaLabel: 'Key Z' },
  { key: 'KeyX', label: 'X', glyph: 'X', ariaLabel: 'Key X' },
  { key: 'Enter', label: 'Enter', glyph: '⏎', ariaLabel: 'Enter' },
  { key: 'Space', label: 'Space', glyph: '␣', ariaLabel: 'Space' },
];

/**
 * True when the iframe's RFB instance exists and reports a live connection.
 * Used to grey out the pad instead of silently swallowing taps.
 */
export function isViewerReady(iframe: HTMLIFrameElement | null): boolean {
  if (!iframe) return false;
  try {
    const win = iframe.contentWindow as ViewerWindow | null;
    const rfb = win?.rfb;
    if (!rfb || typeof rfb.sendKey !== 'function') return false;
    // `_rfbConnectionState` is internal but stable across noVNC 1.2+; when it is
    // missing we optimistically treat the instance as usable (sendKey no-ops
    // itself unless the RFB state is 'connected').
    return rfb._rfbConnectionState === undefined || rfb._rfbConnectionState === 'connected';
  } catch {
    // Cross-origin / not-yet-loaded document.
    return false;
  }
}

/**
 * Send a key transition into the noVNC iframe.
 * Returns false when the bridge is not available (caller can ignore).
 */
export function sendKeyToViewer(
  iframe: HTMLIFrameElement | null,
  key: GamepadKey,
  down: boolean,
): boolean {
  if (!iframe) return false;

  const keysym = KEYSYMS[key];

  try {
    const win = iframe.contentWindow as ViewerWindow | null;
    if (!win) return false;

    // Preferred path: the RFB instance exported by vnc_lite.html.
    const rfb = win.rfb;
    if (rfb && typeof rfb.sendKey === 'function') {
      if (rfb._rfbConnectionState !== undefined && rfb._rfbConnectionState !== 'connected') {
        return false;
      }
      rfb.sendKey(keysym, key, down);
      return true;
    }

    // Fallback path: no RFB export (e.g. stock noVNC asset swapped in later).
    // Dispatch a real KeyboardEvent on the canvas — noVNC's Keyboard handler
    // listens there and converts it to the same RFB key message.
    const doc = iframe.contentDocument;
    const canvas = doc?.querySelector('canvas');
    if (!doc || !canvas) return false;
    const event = new KeyboardEvent(down ? 'keydown' : 'keyup', {
      key: keyName(key),
      code: key,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(event);
    return true;
  } catch {
    // Sandbox violation, torn-down document, or noVNC not ready.
    return false;
  }
}

function keyName(key: GamepadKey): string {
  switch (key) {
    case 'ArrowUp':
      return 'ArrowUp';
    case 'ArrowDown':
      return 'ArrowDown';
    case 'ArrowLeft':
      return 'ArrowLeft';
    case 'ArrowRight':
      return 'ArrowRight';
    case 'Enter':
      return 'Enter';
    case 'Space':
      return ' ';
    case 'KeyA':
      return 'a';
    case 'KeyS':
      return 's';
    case 'KeyX':
      return 'x';
    case 'KeyZ':
      return 'z';
    default:
      return '';
  }
}
