/**
 * Accessible toggle (role=switch).
 *
 * Rendered as a real button with aria-checked rather than a styled checkbox, so
 * screen readers announce the state and Space/Enter work without a <label>
 * wrapper. `disabled` is used for controls that have no backend yet — a toggle
 * that silently does nothing is worse than one that looks unavailable.
 */
export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledHint?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  disabledHint,
}: SwitchProps): JSX.Element {
  return (
    <div className={['flex items-start justify-between gap-3 py-2', disabled ? 'opacity-60' : ''].join(' ')}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-slate-200">{label}</p>
        {description ? <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{description}</p> : null}
        {disabled && disabledHint ? (
          <p className="mt-1 text-[10px] uppercase tracking-wider text-status-warn/80">{disabledHint}</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors',
          checked ? 'border-neon/50 bg-neon/30' : 'border-white/15 bg-white/10',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all',
            checked ? 'left-[18px] bg-neon' : 'left-0.5 bg-slate-400',
          ].join(' ')}
        />
      </button>
    </div>
  );
}
