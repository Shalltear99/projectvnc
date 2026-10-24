import type { InstanceStatus } from '@/lib/types';

interface StatusStyle {
  label: string;
  dot: string;
  text: string;
  ring: string;
  pulse: boolean;
}

/** Status colours follow docs/design.md: emerald for healthy, rose for failure. */
const STYLES: Record<InstanceStatus, StatusStyle> = {
  provisioning: {
    label: 'Provisioning',
    dot: 'bg-status-warn',
    text: 'text-status-warn',
    ring: 'border-status-warn/30 bg-status-warn/10',
    pulse: true,
  },
  running: {
    label: 'Running',
    dot: 'bg-status-ok',
    text: 'text-status-ok',
    ring: 'border-status-ok/30 bg-status-ok/10',
    pulse: true,
  },
  stopped: {
    label: 'Stopped',
    dot: 'bg-slate-500',
    text: 'text-slate-300',
    ring: 'border-white/10 bg-white/5',
    pulse: false,
  },
  expired: {
    label: 'Expired',
    dot: 'bg-status-bad',
    text: 'text-status-bad',
    ring: 'border-status-bad/30 bg-status-bad/10',
    pulse: false,
  },
  failed: {
    label: 'Failed',
    dot: 'bg-status-bad',
    text: 'text-status-bad',
    ring: 'border-status-bad/30 bg-status-bad/10',
    pulse: false,
  },
};

export function StatusPill({
  status,
  className = '',
}: {
  status: InstanceStatus;
  className?: string;
}): JSX.Element {
  const style = STYLES[status] ?? STYLES.failed;
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        style.ring,
        style.text,
        className,
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={['h-1.5 w-1.5 rounded-full', style.dot, style.pulse ? 'animate-pulse-soft' : ''].join(
          ' ',
        )}
      />
      {style.label}
    </span>
  );
}
