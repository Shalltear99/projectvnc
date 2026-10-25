import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AppShell } from '@/components/AppShell';
import { useToast } from '@/components/Toast';
import { InstanceHeader } from '@/components/vnc/InstanceHeader';
import { JPanelSidebar } from '@/components/vnc/JPanelSidebar';
import { MobileControls } from '@/components/vnc/MobileControls';
import { PowerToolbar } from '@/components/vnc/PowerToolbar';
import { VNCViewerCanvas } from '@/components/vnc/VNCViewerCanvas';
import { Sheet } from '@/components/ui/Sheet';
import { useAuth } from '@/hooks/useAuth';
import { usePolling } from '@/hooks/usePolling';
import { useVncSession } from '@/hooks/useVncSession';
import * as api from '@/lib/api';
import type { InstanceAction } from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { Instance, InstanceMetrics } from '@/lib/types';

/**
 * Session workspace (/dashboard/vnc/[instanceId]).
 *
 * Three sections, per the redesign brief: status header, main workspace grid
 * (canvas + control panel), bottom action toolbar.
 *
 * Layout notes:
 *  - Desktop (>=1024px): canvas and the panel sit side by side, the panel is a
 *    fixed 20rem column.
 *  - Tablet/mobile: the panel becomes a bottom sheet so the canvas keeps the
 *    full width; the floating touch controls appear only on coarse pointers.
 *  - The whole page is 100dvh with no document scroll; only the panel scrolls.
 */

/** Cap on automatic stream reconnects, so a broken proxy cannot loop forever. */
const MAX_HEAL_ATTEMPTS = 4;

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong';
}

export default function VncWorkspacePage(): JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const { user, loading, unavailable } = useAuth({ required: true });

  const raw = router.query.instanceId;
  const instanceId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : null;

  const [busyAction, setBusyAction] = useState<InstanceAction | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  /* --------------------------------------------------------- data feeds --- */
  const instancePoll = usePolling<Instance | null>(
    useCallback(
      async (signal) => (instanceId ? api.getInstance(instanceId, signal) : null),
      [instanceId],
    ),
    5000,
    Boolean(instanceId),
  );

  const metricsPoll = usePolling<InstanceMetrics | null>(
    useCallback(
      async (signal) => (instanceId ? api.metrics(instanceId, signal) : null),
      [instanceId],
    ),
    5000,
    Boolean(instanceId),
  );

  const instance = instancePoll.data;
  const metrics = metricsPoll.data;

  /* ------------------------------------------------------------- stream --- */
  // Only open a VNC session once the instance is actually running; connecting
  // to a stopped container burns a ticket and yields a 409 the user cannot act
  // on.
  const canConnect = instance?.status === 'running';
  const session = useVncSession(canConnect ? instanceId : null);

  /* ------------------------------------------------------------- actions --- */
  const runAction = useCallback(
    async (action: InstanceAction): Promise<void> => {
      if (!instanceId) return;
      setBusyAction(action);
      try {
        await api.instanceAction(instanceId, action);
        toast.success(`${action[0].toUpperCase()}${action.slice(1)} sent.`);
        instancePoll.refresh();
        /*
         * Do NOT re-mint the stream here. A restart/reset invalidates the old
         * ticket, but reconnecting immediately lands on a container that is
         * still shutting down: the websocket opens and is killed at once, and
         * the viewer is left showing "connection is closed". Reconnection is
         * handled by the auto-heal effect below, which waits for the API to
         * report the instance running again.
         */
      } catch (error) {
        toast.error(errorText(error));
      } finally {
        setBusyAction(null);
      }
    },
    [instanceId, instancePoll, toast],
  );

  /* --------------------------------------------------------- auto-heal --- */
  /**
   * Reconnect the viewer when the stream dies but the instance is healthy.
   *
   * This is what makes restart/reset usable: the action invalidates the ticket
   * and kills the websocket, and the container needs a moment to accept RFB
   * connections again. Retrying immediately is what produced a permanently
   * "connection is closed" viewer, so the retry is gated on the API reporting
   * the instance running, and capped so a genuinely broken proxy cannot spin.
   */
  const [healAttempts, setHealAttempts] = useState(0);
  const healTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Depend on primitives, not the session object: `useVncSession` returns a new
  // object every render, so depending on it would clear and reschedule this
  // timer on every poll and it would never fire.
  const { phase: streamPhase, connected: streamConnected, retry: retryStream } = session;
  const instanceStatus = instance?.status;

  useEffect(() => {
    if (streamConnected) {
      setHealAttempts(0);
      return;
    }
    if (streamPhase !== 'error') return;
    if (instanceStatus !== 'running') return;
    if (healAttempts >= MAX_HEAL_ATTEMPTS) return;

    healTimer.current = setTimeout(() => {
      setHealAttempts((n) => n + 1);
      retryStream();
    }, 2500);

    return () => {
      if (healTimer.current) clearTimeout(healTimer.current);
    };
  }, [streamPhase, streamConnected, retryStream, instanceStatus, healAttempts]);

  const openPlans = useCallback(() => {
    void router.push('/dashboard');
  }, [router]);

  const region = useMemo(() => 'Jakarta Node-01', []);

  /* --------------------------------------------------------------- gates --- */
  if (!router.isReady || loading) {
    return (
      <AppShell flush bare>
        <div className="grid h-full place-items-center cyber-bg">
          <div className="flex items-center gap-2 text-[13px] text-slate-500">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-neon/40 border-t-neon" />
            Preparing session…
          </div>
        </div>
      </AppShell>
    );
  }

  if (!user && unavailable) {
    return (
      <AppShell flush bare>
        <div className="grid h-full place-items-center px-6 cyber-bg">
          <div className="cyber-panel max-w-md p-6 text-center">
            <h1 className="text-sm font-semibold text-white">Control plane unreachable</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
              The workspace could not verify your session because the API is not responding.
            </p>
            <button
              type="button"
              onClick={() => void router.reload()}
              className="mt-4 rounded-lg bg-electric px-4 py-2 text-[13px] font-semibold text-white hover:bg-electric-deep"
            >
              Reload
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!instanceId) {
    return (
      <AppShell flush bare>
        <div className="grid h-full place-items-center px-6 text-center cyber-bg">
          <div>
            <p className="text-sm text-slate-300">No instance id in the URL.</p>
            <Link href="/dashboard" className="mt-3 inline-block text-[13px] text-electric">
              Back to instances
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!instance) {
    return (
      <AppShell flush bare>
        <div className="grid h-full place-items-center px-6 cyber-bg">
          {instancePoll.error ? (
            <div className="cyber-panel max-w-md p-6 text-center">
              <h1 className="text-sm font-semibold text-white">Instance unavailable</h1>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{instancePoll.error}</p>
              <Link
                href="/dashboard"
                className="mt-4 inline-block rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[13px] text-slate-300 hover:bg-white/10"
              >
                Back to instances
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[13px] text-slate-500">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-neon/40 border-t-neon" />
              Loading instance…
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  /* --------------------------------------------------------------- render --- */
  const sidebar = (
    <JPanelSidebar instance={instance} busyAction={busyAction} onAction={(a) => void runAction(a)} />
  );

  return (
    <AppShell flush bare>
      <Head>
        <title>Session {instance.id.slice(0, 8)} — CloudJava VNC</title>
      </Head>

      <div className="cyber-bg flex h-full min-h-0 flex-col">
        <InstanceHeader
          instance={instance}
          metrics={metrics}
          streamLive={session.connected}
          region={region}
          onOpenPlans={openPlans}
        />

        {/* Main workspace: canvas + panel side by side from lg up. */}
        <div className="flex min-h-0 flex-1 gap-3 p-2 sm:p-3">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <VNCViewerCanvas session={session} className="flex-1">
              <MobileControls iframeRef={session.iframeRef} active={session.connected} />
            </VNCViewerCanvas>
          </div>

          <div className="hidden w-80 shrink-0 lg:flex">{sidebar}</div>
        </div>

        <PowerToolbar
          instance={instance}
          busyAction={busyAction}
          onAction={(a) => void runAction(a)}
          onOpenControls={() => setSheetOpen(true)}
          onOpenPlans={openPlans}
        />
      </div>

      {/* Mobile: the same panel, as a bottom sheet. */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Instance controls">
        {sidebar}
      </Sheet>
    </AppShell>
  );
}
