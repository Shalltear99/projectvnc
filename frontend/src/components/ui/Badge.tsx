import type { ReactNode } from 'react';

type Tone = 'neutral' | 'online' | 'offline' | 'warn' | 'info';

const TONE: Record<Tone, string> = {
  neutral: 'border-white/10 bg-white/5 text-slate-300',
  online: 'border-neon/30 bg-neon/10 text-neon',
  offline: 'border-status-bad/30 bg-status-bad/10 text-status-bad',
  warn: 'border-status-warn/30 bg-status-warn/10 text-status-warn',
  info: 'border-electric/30 bg-electric/10 text-electric',
};

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  mono?: boolean;
  title?: string;
}

/** Small pill used for status, region and resource labels. */
export function Badge({ tone = 'neutral', children, className = '', mono = false, title }: BadgeProps): JSX.Element {
  return (
    <span
      title={title}
      className={[
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium leading-none',
        TONE[tone],
        mono ? 'font-mono tabular-nums' : '',
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

/**
 * Status dot with an expanding halo when live.
 *
 * `pulse` is a real state indicator, not decoration: it only animates while the
 * stream is actually connected, so a frozen animation means a frozen session.
 */
export function StatusDot({ live, tone }: { live: boolean; tone?: 'ok' | 'bad' | 'warn' }): JSX.Element {
  const colour = tone === 'bad' ? 'bg-status-bad' : tone === 'warn' ? 'bg-status-warn' : 'bg-neon';
  return (
    <span className="relative grid h-2.5 w-2.5 place-items-center" aria-hidden="true">
      {live ? (
        <span className={['absolute inset-0 rounded-full opacity-70 animate-pulse-dot', colour].join(' ')} />
      ) : null}
      <span className={['relative h-2 w-2 rounded-full', live ? colour : 'bg-slate-600'].join(' ')} />
    </span>
  );
}
