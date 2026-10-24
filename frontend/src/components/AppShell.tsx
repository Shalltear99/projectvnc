import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Button } from './Button';
import { useAuth } from '@/hooks/useAuth';

export interface AppShellProps {
  children: ReactNode;
  /** Compact chrome for the viewer page: no page scroll, no footer. */
  flush?: boolean;
  /** Right-hand slot in the header (e.g. a fullscreen toggle). */
  actions?: ReactNode;
}

function Wordmark(): JSX.Element {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="CloudJava VNC home">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-md border border-accent/40 bg-accent/15 text-accent"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5 14h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M7 6.2l2.2 1.8L7 9.8V6.2z" fill="currentColor" />
        </svg>
      </span>
      <span className="text-sm font-semibold tracking-tight text-white">
        CloudJava<span className="text-slate-500"> VNC</span>
      </span>
    </Link>
  );
}

export function AppShell({ children, flush = false, actions }: AppShellProps): JSX.Element {
  const { user, logout } = useAuth();
  const router = useRouter();
  const isDashboard = router.pathname === '/dashboard';

  const handleLogout = async (): Promise<void> => {
    await logout();
    void router.replace('/login');
  };

  return (
    <div className={flush ? 'flex h-[100dvh] flex-col overflow-hidden' : 'flex min-h-[100dvh] flex-col'}>
      <header
        className={[
          'z-30 shrink-0 border-b border-white/5 bg-surface-base/80 backdrop-blur',
          flush ? '' : 'sticky top-0',
        ].join(' ')}
      >
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Wordmark />

          <nav className="ml-4 hidden items-center gap-1 sm:flex" aria-label="Main">
            <Link
              href="/dashboard"
              aria-current={isDashboard ? 'page' : undefined}
              className={[
                'rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                isDashboard ? 'bg-white/5 text-white' : 'text-slate-400 hover:text-slate-200',
              ].join(' ')}
            >
              Instances
            </Link>
            <Link
              href="/#plans"
              className="rounded-md px-2.5 py-1.5 text-[13px] text-slate-400 transition-colors hover:text-slate-200"
            >
              Plans
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {actions}
            {user ? (
              <>
                <span className="hidden max-w-[18ch] truncate font-mono text-xs text-slate-500 sm:inline">
                  {user.email}
                </span>
                <Button size="sm" variant="ghost" onClick={() => void handleLogout()}>
                  Sign out
                </Button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-md px-2.5 py-1.5 text-[13px] text-slate-300 transition-colors hover:text-white"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-white/10"
                >
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className={flush ? 'min-h-0 flex-1' : 'flex-1'}>{children}</main>

      {flush ? null : (
        <footer className="border-t border-white/5 py-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>CloudJava VNC — isolated Java desktops in the browser.</span>
            <span className="font-mono">noVNC 1.5.0 · OpenJDK 8/11/17/21 · Openbox</span>
          </div>
        </footer>
      )}
    </div>
  );
}
