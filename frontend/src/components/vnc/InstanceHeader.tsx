import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Instance, InstanceMetrics } from '@/lib/types';
import { remainingUntil } from '@/lib/format';
import { Badge, StatusDot } from '../ui/Badge';
import { Meter } from '../ui/Meter';

/**
 * Top status header of the session workspace.
 *
 * Three zones, as specified: identity + live status (left), the rental
 * countdown (centre), live resource badges + renewal (right).
 *
 * The countdown ticks locally from `expiresAt` every second and is never driven
 * by a server poll — a network hiccup must not freeze the clock.
 */
export interface InstanceHeaderProps {
  instance: Instance;
  metrics: InstanceMetrics | null;
  /** True while the VNC stream itself reports Connected. */
  streamLive: boolean;
  /** Node label, e.g. "Jakarta Node-01". Static config, not fabricated per user. */
  region: string;
  onOpenPlans: () => void;
}

const REGION_LABEL = 'Jakarta Node-01';

/**
 * The API stores plan ids with a `plan_` prefix (`plan_daily`), while the
 * frontend's Plan type uses bare ids (`daily`). Normalise once here instead of
 * comparing against literals — an exact `=== 'daily'` check silently labelled
 * every weekly/monthly instance as "Monthly".
 */
function planLabel(planId: string): string {
  const bare = planId.replace(/^plan_/, '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** HH:MM:SS, or `Nd HH:MM:SS` past 24 h. */
function formatCountdown(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

export function InstanceHeader({
  instance,
  metrics,
  streamLive,
  region = REGION_LABEL,
  onOpenPlans,
}: InstanceHeaderProps): JSX.Element {
  /**
   * `0` on the server and on the first client render, then real time once
   * mounted. Seeding this with Date.now() would make the SSR markup and the
   * first client render disagree and React would complain about hydration.
   */
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = remainingUntil(instance.expiresAt, now);
  const running = instance.status === 'running';
  const online = running && streamLive;

  const cpu = metrics && metrics.cpuPercent >= 0 ? metrics.cpuPercent : null;
  const ramPercent =
    metrics && metrics.memoryLimitMb > 0
      ? (metrics.memoryUsedMb / metrics.memoryLimitMb) * 100
      : null;
  const ramDetail =
    metrics && metrics.memoryLimitMb > 0
      ? `${Math.round(metrics.memoryUsedMb)} / ${Math.round(metrics.memoryLimitMb)} MB`
      : undefined;

  const statusText = online
    ? 'Online'
    : running
      ? 'Starting'
      : instance.status === 'provisioning'
        ? 'Provisioning'
        : instance.status === 'stopped'
          ? 'Stopped'
          : instance.status === 'expired'
            ? 'Expired'
            : 'Failed';

  return (
    <header className="shrink-0 border-b border-cyber-line bg-cyber-panel/80 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4">
        {/* ---------------------------------------------------- identity --- */}
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/dashboard"
            aria-label="Back to instances"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 text-slate-400 transition-colors hover:text-white"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M7.5 2L3.5 6l4 4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[13px] font-semibold text-white">
                {planLabel(instance.planId)} · JDK {instance.javaVersion}
              </h1>
              <span className="flex items-center gap-1.5">
                <StatusDot
                  live={online}
                  tone={online ? 'ok' : running ? 'warn' : instance.status === 'failed' || instance.status === 'expired' ? 'bad' : 'warn'}
                />
                <span
                  className={[
                    'text-[11px] font-medium',
                    online ? 'text-neon' : instance.status === 'failed' ? 'text-status-bad' : 'text-slate-400',
                  ].join(' ')}
                >
                  {statusText}
                </span>
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
              <span title="Worker node this container runs on">🇮🇩 {region}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono" title={instance.id}>
                {instance.id.slice(0, 8)}
              </span>
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------- countdown --- */}
        <div className="order-last w-full sm:order-none sm:mx-auto sm:w-auto">
          <div className="flex items-center justify-center gap-2 rounded-lg border border-cyber-line bg-cyber-raised/80 px-3 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Time left</span>
            <span
              className={[
                'font-mono text-[15px] font-semibold tabular-nums',
                remaining.expired ? 'text-status-bad' : remaining.totalSeconds < 600 ? 'text-status-warn' : 'text-neon',
              ].join(' ')}
            >
              {remaining.label === '—' ? '--:--:--' : formatCountdown(remaining.totalSeconds)}
            </span>
          </div>
        </div>

        {/* ------------------------------------------------------ resources --- */}
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden w-28 sm:block">
            <Meter label="CPU" value={cpu} />
          </div>
          <div className="hidden w-32 sm:block">
            <Meter label="RAM" value={ramPercent} detail={ramDetail} />
          </div>

          {/* Compact meters on phones: numbers only, no bars. */}
          <div className="flex items-center gap-1.5 sm:hidden">
            <Badge mono tone={cpu !== null && cpu >= 85 ? 'warn' : 'neutral'}>
              CPU {cpu !== null ? `${Math.round(cpu)}%` : '—'}
            </Badge>
            <Badge mono tone={ramPercent !== null && ramPercent >= 85 ? 'warn' : 'neutral'}>
              RAM {ramPercent !== null ? `${Math.round(ramPercent)}%` : '—'}
            </Badge>
          </div>

          <button
            type="button"
            onClick={onOpenPlans}
            className="shrink-0 rounded-lg border border-electric/40 bg-electric/15 px-2.5 py-1.5 text-[11px] font-semibold text-electric transition-colors hover:bg-electric/25"
            title="Extend this rental by buying another plan"
          >
            + Perpanjang
          </button>
        </div>
      </div>
    </header>
  );
}
