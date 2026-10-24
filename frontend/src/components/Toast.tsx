import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ToastMessage, ToastVariant } from '@/lib/types';

interface ToastApi {
  push: (text: string, variant?: ToastVariant) => void;
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const VARIANT_CLASS: Record<ToastVariant, string> = {
  success: 'border-status-ok/40 bg-status-ok/10 text-status-ok',
  error: 'border-status-bad/40 bg-status-bad/10 text-status-bad',
  info: 'border-white/10 bg-surface-card text-slate-200',
};

const DURATION_MS = 5000;

let counter = 0;

/** Minimal toast stack — no external UI library. */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastMessage[]>([]);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (text: string, variant: ToastVariant = 'info') => {
      counter += 1;
      const id = `t${counter}`;
      setItems((current) => [...current.slice(-3), { id, variant, text }]);
      const timer = setTimeout(() => dismiss(id), DURATION_MS);
      timers.current.push(timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (text: string) => push(text, 'success'),
      error: (text: string) => push(text, 'error'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={[
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm shadow-panel animate-fade-in',
              VARIANT_CLASS[item.variant],
            ].join(' ')}
          >
            <span className="flex-1 leading-snug">{item.text}</span>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-0.5 text-current/70 transition-opacity hover:opacity-100"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M2 2l8 8M10 2l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return context;
}
