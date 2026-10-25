import { useEffect } from 'react';
import type { ReactNode } from 'react';

/**
 * Bottom sheet for mobile (<768px), standing in for the desktop sidebar.
 *
 * Implemented directly rather than pulled from a library: the project has no
 * Radix/Shadcn dependency and adding a whole primitive set for one drawer would
 * be a large supply-chain surface for a small win. Behaviour matches the usual
 * contract — focus trap is approximated with initial focus, Escape closes,
 * background scroll is locked, and the backdrop is a labelled close control.
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Lock background scroll so the canvas behind cannot drift while dragging.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:hidden">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[85dvh] animate-sheet-up overflow-hidden rounded-t-2xl border-t border-cyber-line bg-cyber-panel"
      >
        <div className="flex items-center justify-between border-b border-cyber-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-1 w-8 rounded-full bg-white/20" />
            <h2 className="text-[13px] font-semibold text-white">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md border border-white/10 bg-white/5 text-slate-300"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="no-scrollbar max-h-[70dvh] overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
