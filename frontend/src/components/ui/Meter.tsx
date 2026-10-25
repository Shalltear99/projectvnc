/**
 * Thin resource meter (CPU / RAM).
 *
 * `value` is a 0-100 percentage. When `known` is false the meter renders an
 * indeterminate track instead of a fake 0% bar — an unknown metric must not look
 * like an idle one.
 */
export interface MeterProps {
  label: string;
  value: number | null;
  detail?: string;
  className?: string;
}

function toneFor(value: number): string {
  if (value >= 90) return 'bg-status-bad';
  if (value >= 70) return 'bg-status-warn';
  return 'bg-neon';
}

export function Meter({ label, value, detail, className = '' }: MeterProps): JSX.Element {
  const known = typeof value === 'number' && Number.isFinite(value);
  const pct = known ? Math.max(0, Math.min(100, value as number)) : 0;

  return (
    <div className={['min-w-0', className].join(' ')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-slate-300">
          {known ? `${Math.round(pct)}%` : '—'}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8">
        <div
          className={[
            'h-full rounded-full transition-[width] duration-500',
            known ? toneFor(pct) : 'bg-slate-700/60 animate-pulse-soft',
          ].join(' ')}
          style={{ width: known ? `${pct}%` : '100%' }}
        />
      </div>
      {detail ? (
        <p className="mt-1 truncate font-mono text-[10px] text-slate-500" title={detail}>
          {detail}
        </p>
      ) : null}
    </div>
  );
}
