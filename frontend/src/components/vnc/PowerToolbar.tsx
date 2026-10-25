import type { Instance } from '@/lib/types';
import type { InstanceAction } from '@/lib/api';

/**
 * Bottom action toolbar.
 *
 * Mirrors the power actions from the sidebar on purpose: on a phone the sidebar
 * is behind a sheet, so the primary controls must stay one tap away. Both
 * surfaces call the same handler, so they cannot disagree.
 */
export interface PowerToolbarProps {
  instance: Instance;
  busyAction: InstanceAction | null;
  onAction: (action: InstanceAction) => void;
  onOpenControls: () => void;
  onOpenPlans: () => void;
}

function ActionButton({
  label,
  onClick,
  disabled,
  busy,
  tone = 'neutral',
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'neutral' | 'primary' | 'danger';
  title?: string;
}): JSX.Element {
  const tones = {
    neutral: 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10',
    primary: 'border-neon/40 bg-neon/15 text-neon hover:bg-neon/25',
    danger: 'border-status-bad/40 bg-status-bad/15 text-status-bad hover:bg-status-bad/25',
  } as const;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={[
        'rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        tones[tone],
      ].join(' ')}
    >
      {busy ? '…' : label}
    </button>
  );
}

export function PowerToolbar({
  instance,
  busyAction,
  onAction,
  onOpenControls,
  onOpenPlans,
}: PowerToolbarProps): JSX.Element {
  const running = instance.status === 'running';

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-cyber-line bg-cyber-panel/80 px-3 py-2 backdrop-blur">
      <div className="no-scrollbar flex flex-1 items-center gap-1.5 overflow-x-auto">
        <ActionButton
          label="Start"
          tone="primary"
          onClick={() => onAction('start')}
          disabled={running}
          busy={busyAction === 'start'}
        />
        <ActionButton
          label="Stop"
          onClick={() => onAction('stop')}
          disabled={!running}
          busy={busyAction === 'stop'}
        />
        <ActionButton
          label="Restart"
          onClick={() => onAction('restart')}
          busy={busyAction === 'restart'}
        />
        <ActionButton
          label="Rebuild"
          tone="danger"
          onClick={() => onAction('reset')}
          busy={busyAction === 'reset'}
          title="Destroy the container and provision a fresh one"
        />
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-white/10" />
        <ActionButton label="+ Perpanjang" onClick={onOpenPlans} title="Buy more time for this instance" />
      </div>

      {/* Sidebar is a sheet on phones; this is its handle. */}
      <button
        type="button"
        onClick={onOpenControls}
        className="shrink-0 rounded-lg border border-electric/40 bg-electric/15 px-3 py-1.5 text-[11px] font-semibold text-electric transition-colors hover:bg-electric/25 lg:hidden"
      >
        Panel
      </button>
    </div>
  );
}
