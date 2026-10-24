import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingState<T> {
  data: T | null;
  error: string | null;
  /** True only for the very first load (or after `enabled` flips back on). */
  loading: boolean;
  /** Manual refresh, does not reset `data`. */
  refresh: () => void;
}

/**
 * Interval fetch with cleanup and no overlapping requests.
 *
 * - the next tick is scheduled only after the previous request settled, so a slow
 *   backend can never pile up requests;
 * - the loop stops while the tab is hidden (saves worker CPU on a VNC session);
 * - every run is guarded by an abort controller + mounted flag, so an unmount or
 *   a changed fetcher never calls setState.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  enabled = true,
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);

  const fetcherRef = useRef(fetcher);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const [tick, setTick] = useState(0);

  fetcherRef.current = fetcher;

  const refresh = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const schedule = (): void => {
      if (cancelled || !mountedRef.current) return;
      timerRef.current = setTimeout(run, intervalMs);
    };

    const run = async (): Promise<void> => {
      if (cancelled || runningRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) {
        schedule();
        return;
      }

      runningRef.current = true;
      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const result = await fetcherRef.current(controller.signal);
        if (!cancelled && mountedRef.current) {
          setData(result);
          setError(null);
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          return;
        }
        if (!cancelled && mountedRef.current) {
          setError(caught instanceof Error ? caught.message : 'Request failed');
        }
      } finally {
        runningRef.current = false;
        if (!cancelled && mountedRef.current) {
          setLoading(false);
          schedule();
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      controllerRef.current?.abort();
      controllerRef.current = null;
      runningRef.current = false;
    };
  }, [enabled, intervalMs, tick]);

  return { data, error, loading, refresh };
}
