/** Small formatting helpers shared by the dashboard and the viewer. */

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export interface Remaining {
  expired: boolean;
  totalSeconds: number;
  label: string;
}

/** Countdown label for `expiresAt`; recomputed by callers on a 1 s tick. */
export function remainingUntil(expiresAt: string, now: number = Date.now()): Remaining {
  if (!(now > 0)) {
    // Sentinel used during SSR/first render to avoid a hydration mismatch —
    // render a placeholder instead of a bogus countdown.
    return { expired: false, totalSeconds: 0, label: '—' };
  }
  const target = new Date(expiresAt).getTime();
  if (Number.isNaN(target)) {
    return { expired: true, totalSeconds: 0, label: 'unknown' };
  }
  const totalSeconds = Math.max(0, Math.floor((target - now) / 1000));
  if (totalSeconds === 0) {
    return { expired: true, totalSeconds: 0, label: 'expired' };
  }
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  const label = days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return { expired: false, totalSeconds, label };
}

export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-3)}`;
}

export function formatMb(value: number): string {
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(value)} MB`;
}
