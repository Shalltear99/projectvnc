import { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { InstanceCard } from '@/components/InstanceCard';
import { StatusPill } from '@/components/StatusPill';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/hooks/useAuth';
import { usePolling } from '@/hooks/usePolling';
import * as api from '@/lib/api';
import { ApiError, type InstanceAction } from '@/lib/api';
import { JAVA_VERSIONS, PLANS, formatIdr } from '@/lib/plans';
import type { Instance } from '@/lib/types';

type PendingAction = InstanceAction | 'delete';

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.isNetworkError
      ? 'Cannot reach the control plane. Check that the API is running.'
      : error.message;
  }
  return error instanceof Error ? error.message : 'Unexpected error.';
}

function SkeletonCard(): JSX.Element {
  return (
    <div className="panel animate-pulse p-5">
      <div className="h-4 w-24 rounded bg-white/5" />
      <div className="mt-3 h-5 w-40 rounded bg-white/5" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="h-8 rounded bg-white/5" />
        <div className="h-8 rounded bg-white/5" />
      </div>
      <div className="mt-4 h-10 rounded bg-white/5" />
    </div>
  );
}

export default function DashboardPage(): JSX.Element {
  const { user, loading: authLoading, unavailable } = useAuth({ required: true });
  const toast = useToast();

  const [pending, setPending] = useState<Record<string, PendingAction>>({});
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [planId, setPlanId] = useState<string>(PLANS[1].id);
  const [javaVersion, setJavaVersion] = useState<string>(JAVA_VERSIONS[2]);

  const fetcher = useCallback((signal: AbortSignal) => api.listInstances(signal), []);
  const { data, error, loading, refresh } = usePolling<Instance[]>(fetcher, 5000, Boolean(user));

  const instances = useMemo(() => data ?? [], [data]);

  const setPendingFor = (id: string, action: PendingAction | null): void => {
    setPending((current) => {
      const next = { ...current };
      if (action === null) {
        delete next[id];
      } else {
        next[id] = action;
      }
      return next;
    });
  };

  const runAction = async (instance: Instance, action: InstanceAction): Promise<void> => {
    setPendingFor(instance.id, action);
    try {
      await api.instanceAction(instance.id, action);
      toast.success(`${action[0].toUpperCase()}${action.slice(1)} sent to ${instance.id.slice(0, 8)}.`);
      refresh();
    } catch (caught) {
      toast.error(errorText(caught));
    } finally {
      setPendingFor(instance.id, null);
    }
  };

  const removeInstance = async (instance: Instance): Promise<void> => {
    if (confirmingDelete !== instance.id) {
      setConfirmingDelete(instance.id);
      return;
    }
    setConfirmingDelete(null);
    setPendingFor(instance.id, 'delete');
    try {
      await api.deleteInstance(instance.id);
      toast.success('Instance deleted.');
      refresh();
    } catch (caught) {
      toast.error(errorText(caught));
    } finally {
      setPendingFor(instance.id, null);
    }
  };

  const createInstance = async (): Promise<void> => {
    setCreating(true);
    try {
      // The API returns a checkout session, not an instance: containers are only
      // created when the payment webhook settles. A client that could provision
      // directly would be able to run a container without paying.
      const session = await api.createInstance({ planId, javaVersion });

      if (session.provider === 'mock') {
        // Development only: settle inline so the flow is testable without a
        // gateway. The endpoint 404s when a real provider is configured.
        await api.settleMockOrder(session.orderId);
        toast.success('Payment settled (mock). Provisioning your instance…');
        refresh();
        return;
      }

      // Real gateway: hand the user over. We do not poll — the webhook does the
      // work, and the dashboard picks the instance up on the next refresh.
      window.location.href = session.checkoutUrl;
    } catch (caught) {
      toast.error(errorText(caught));
    } finally {
      setCreating(false);
    }
  };

  const counts = useMemo(() => {
    return {
      total: instances.length,
      running: instances.filter((item) => item.status === 'running').length,
    };
  }, [instances]);

  return (
    <AppShell>
      <Head>
        <title>Instances — CloudJava VNC</title>
      </Head>

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Instances</h1>
            <p className="mt-1.5 text-[13px] text-slate-400">
              {authLoading
                ? 'Checking your session…'
                : `${counts.running} running of ${counts.total} total`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={refresh} disabled={!user}>
              Refresh
            </Button>
          </div>
        </div>

        {unavailable ? (
          <div className="mt-5 rounded-lg border border-status-warn/30 bg-status-warn/10 px-3.5 py-2.5 text-[13px] text-status-warn">
            The control plane is unreachable, so instance state may be stale. Retrying automatically.
          </div>
        ) : null}

        {/* Create */}
        <section className="panel mt-6 p-4 sm:p-5">
          <h2 className="text-xs font-medium uppercase tracking-widest text-slate-500">
            New instance
          </h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="label" htmlFor="plan">
                Plan
              </label>
              <select
                id="plan"
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
                disabled={creating || !user}
                className="field"
              >
                {PLANS.map((plan) => (
                  <option key={plan.id} value={plan.id} className="bg-surface-card">
                    {plan.name} — {formatIdr(plan.priceIdr)} / {plan.durationMinutes} min
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:w-40">
              <label className="label" htmlFor="jdk">
                OpenJDK
              </label>
              <select
                id="jdk"
                value={javaVersion}
                onChange={(event) => setJavaVersion(event.target.value)}
                disabled={creating || !user}
                className="field"
              >
                {JAVA_VERSIONS.map((version) => (
                  <option key={version} value={version} className="bg-surface-card">
                    JDK {version}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="primary"
              loading={creating}
              disabled={creating || !user}
              onClick={() => void createInstance()}
            >
              Provision
            </Button>
          </div>
        </section>

        {/* List */}
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-widest text-slate-500">
              Your instances
            </h2>
            {error ? (
              <span className="font-mono text-[11px] text-status-bad">list failed</span>
            ) : (
              <span className="font-mono text-[11px] text-slate-600">poll 5s</span>
            )}
          </div>

          {authLoading || (loading && data === null) ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : error && data === null ? (
            <div className="panel p-6 text-center">
              <p className="text-sm font-medium text-white">Could not load instances</p>
              <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-slate-400">
                {error}
              </p>
              <div className="mt-4">
                <Button variant="primary" size="sm" onClick={refresh}>
                  Retry
                </Button>
              </div>
            </div>
          ) : instances.length === 0 ? (
            <div className="panel flex flex-col items-center px-6 py-12 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-500" />
              </div>
              <p className="mt-3 text-sm font-medium text-white">No instances yet</p>
              <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-slate-400">
                Pick a plan and a JDK above. Provisioning takes a few seconds; the card appears here
                as soon as the container reports ready.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <StatusPill status="stopped" />
                <span className="font-mono text-[11px] text-slate-600">idle</span>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {instances.map((instance) => (
                <InstanceCard
                  key={instance.id}
                  instance={instance}
                  pending={pending[instance.id] ?? null}
                  onAction={(target, action) => void runAction(target, action)}
                  onDelete={(target) => void removeInstance(target)}
                />
              ))}
            </div>
          )}

          {confirmingDelete ? (
            <p className="mt-3 text-[12px] text-slate-500">
              Press Delete again on{' '}
              <span className="font-mono text-slate-300">{confirmingDelete.slice(0, 8)}</span> to
              confirm — the container and its disk are destroyed.
            </p>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
