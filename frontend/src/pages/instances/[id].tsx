import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AppShell } from '@/components/AppShell';
import { RemoteViewer } from '@/components/RemoteViewer';
import { useAuth } from '@/hooks/useAuth';

export default function InstanceViewerPage(): JSX.Element {
  const router = useRouter();
  const { user, loading, unavailable } = useAuth({ required: true });

  const raw = router.query.id;
  const instanceId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : null;

  return (
    <AppShell flush>
      <Head>
        <title>Session — CloudJava VNC</title>
      </Head>

      {!router.isReady || loading ? (
        <div className="grid h-full place-items-center">
          <div className="flex items-center gap-2 text-[13px] text-slate-500">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/40 border-t-accent" />
            Preparing session…
          </div>
        </div>
      ) : !user && unavailable ? (
        <div className="grid h-full place-items-center px-6">
          <div className="panel max-w-md p-6 text-center">
            <h1 className="text-sm font-semibold text-white">Control plane unreachable</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
              The dashboard could not verify your session because the API is not responding. Start
              the backend and reload this page.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => void router.reload()}
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-strong"
              >
                Reload
              </button>
              <Link
                href="/dashboard"
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[13px] text-slate-300 hover:bg-white/10"
              >
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      ) : !instanceId ? (
        <div className="grid h-full place-items-center px-6 text-center">
          <div>
            <p className="text-sm text-slate-300">No instance id in the URL.</p>
            <Link href="/dashboard" className="mt-3 inline-block text-[13px] text-accent">
              Back to instances
            </Link>
          </div>
        </div>
      ) : (
        <RemoteViewer instanceId={instanceId} />
      )}
    </AppShell>
  );
}
