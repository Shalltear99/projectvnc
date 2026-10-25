import type { ReactNode } from 'react';

export interface TabSpec {
  id: string;
  label: string;
  icon?: ReactNode;
}

/**
 * Tab strip with proper ARIA wiring (tablist/tab/tabpanel).
 *
 * The strip scrolls horizontally on narrow sidebars instead of wrapping, so the
 * panel height never jumps when a label is long.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: readonly TabSpec[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Instance controls"
      className={['no-scrollbar flex gap-1 overflow-x-auto border-b border-cyber-line px-2', className].join(' ')}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={[
              'relative shrink-0 whitespace-nowrap px-3 py-2.5 text-[12px] font-medium transition-colors',
              // Inactive tabs need a visible affordance: plain grey text reads
              // as a label rather than a control.
              selected
                ? 'text-neon'
                : 'rounded-t-md text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
            ].join(' ')}
          >
            <span className="flex items-center gap-1.5">
              {tab.icon}
              {tab.label}
            </span>
            {selected ? (
              <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-neon" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: string;
  children: ReactNode;
}): JSX.Element | null {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="animate-fade-in">
      {children}
    </div>
  );
}
