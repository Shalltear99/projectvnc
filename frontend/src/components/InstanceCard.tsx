import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Instance, InstanceMetrics } from '@/lib/types';
import type { InstanceAction } from '@/lib/api';
import { metrics as fetchMetrics } from '@/lib/api';
import { usePolling } from '@/hooks/usePolling';
import { formatDateTime, formatMb, remainingUntil, shortId } from '@/lib/format';
import { getPlan } from '@/lib/plans';
import { Button } from './Button';
import { StatusPill } from './StatusPill';

export interface InstanceCardProps {
  instance: Instance;
  /** Action currently in flight for this instance, if any. */
  pending: InstanceAction | 'delete' | null;
  onAction: (instance: Instance, action: InstanceAction) => void;
  onDelete: (instance: Instance) => void;
}

function Gauge({
  label,
  percent,
  value,
  tone,
}: {
  label: string;
  percent: number;
  value: string;
  tone: string;
}): JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
        <span className="mono-value text-[11px] text-slate-400">{value}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className={['h-full rounded-full transition-[width] duration-500', tone].join(' ')}
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );
}

export function InstanceCard({ instance, pending, onAction, onDelete }: InstanceCardProps): JSX.Element {
  const plan = getPlan(instance.planId);
  // Seeded to 0 on both server and client to avoid a hydration mismatch: the
  // countdown only starts rendering real values after the 1 s tick below fires
  // (and the label falls back to '—' until then).
  const [now, setNow] = useState<number>(0);

  // 1 s tick keeps the countdown honest without re-fetching anything.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetcher = useCallback(
    (signal: AbortSignal) => fetchMetrics(instance.id, signal),
    [instance.id],
  );

  // Live CPU/RAM, every 3 s, only while the instance is actually running.
  const { data: live, error: metricsError } = usePolling<InstanceMetrics>(
    fetcher,
    3000,
    instance.status === 'running',
  );

  const remaining = remainingUntil(instance.expiresAt, now);
  const busy = pending !== null;
  const canStart = instance.status === 'stopped' || instance.status === 'expired';
  const canStop = instance.status === 'running' || instance.status === 'provisioning';
  const canLaunch = instance.status === 'running';

  const cpu = live?.cpuPercent ?? 0;
  const memUsed = live?.memoryUsedMb ?? 0;
  const memLimit = live?.memoryLimitMb ?? 0;
  const memPercent = memLimit > 0 ? (memUsed / memLimit) * 100 : 0;

  return (
    <article className="panel flex flex-col gap-4 p-4 sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusPill status={instance.status} />
            <span className="font-mono text-[11px] text-slate-500" title={instance.id}>
              {shortId(instance.id)}
            </span>
          </div>
          <h3 className="mt-2 truncate text-[15px] font-semibold text-white">
            OpenJDK {instance.javaVersion}
            <span className="ml-2 text-sm font-normal text-slate-500">
              {plan ? plan.name : instance.planId}
            </span>
          </h3>
        </div>
        <Link
          href={`/instances/${encodeURIComponent(instance.id)}`}
          className={[
            'shrink-0 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors',
            canLaunch
              ? 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25'
              : 'pointer-events-none border-white/10 bg-white/5 text-slate-500',
          ].join(' ')}
          aria-disabled={!canLaunch}
          tabIndex={canLaunch ? 0 : -1}
        >
          Launch
        </Link>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
        <div className="min-w-0">
          <dt className="text-slate-500">Time left</dt>
          <dd
            className={[
              'mono-value',
              remaining.expired ? 'text-status-bad' : remaining.totalSeconds < 3600 ? 'text-status-warn' : '',
            ].join(' ')}
          >
            {remaining.label}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-slate-500">WS port</dt>
          <dd className="mono-value">{instance.wsPort || '—'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-slate-500">Created</dt>
          <dd className="mono-value">{formatDateTime(instance.createdAt)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-slate-500">Expires</dt>
          <dd className="mono-value">{formatDateTime(instance.expiresAt)}</dd>
        </div>
      </dl>

      <div className="grid grid-cols-2 gap-4">
        <Gauge
          label="CPU"
          percent={cpu}
          value={instance.status === 'running' ? `${cpu.toFixed(0)}%` : 'idle'}
          tone={cpu > 85 ? 'bg-status-bad' : cpu > 60 ? 'bg-status-warn' : 'bg-accent'}
        />
        <Gauge
          label="RAM"
          percent={memPercent}
          value={
            instance.status === 'running' && (memUsed > 0 || memLimit > 0)
              ? memLimit > 0
                ? `${formatMb(memUsed)} / ${formatMb(memLimit)}`
                : formatMb(memUsed)
              : 'idle'
          }
          tone={memPercent > 85 ? 'bg-status-bad' : memPercent > 65 ? 'bg-status-warn' : 'bg-status-ok'}
        />
      </div>

      {metricsError && instance.status === 'running' ? (
        <p className="text-[11px] text-slate-500">Metrics unavailable — {metricsError}</p>
      ) : null}

      {instance.failureReason ? (
        <p className="rounded-md border border-status-bad/20 bg-status-bad/5 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-status-bad/90">
          {instance.failureReason}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">
        {canStart ? (
          <Button size="sm" variant="primary" loading={pending === 'start'} disabled={busy} onClick={() => onAction(instance, 'start')}>
            Start
          </Button>
        ) : (
          <Button size="sm" loading={pending === 'stop'} disabled={!canStop || busy} onClick={() => onAction(instance, 'stop')}>
            Stop
          </Button>
        )}
        <Button
          size="sm"
          loading={pending === 'restart'}
          disabled={busy || instance.status !== 'running'}
          onClick={() => onAction(instance, 'restart')}
        >
          Restart
        </Button>
        <Button
          size="sm"
          loading={pending === 'reset'}
          disabled={busy || instance.status === 'provisioning'}
          onClick={() => onAction(instance, 'reset')}
        >
          Reset
        </Button>
        <Button
          size="sm"
          variant="danger"
          className="ml-auto"
          loading={pending === 'delete'}
          disabled={busy}
          onClick={() => onDelete(instance)}
        >
          Delete
        </Button>
      </div>
    </article>
  );
}
