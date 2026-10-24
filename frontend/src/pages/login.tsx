import Head from 'next/head';
import { AppShell } from '@/components/AppShell';
import { AuthForm } from '@/components/AuthForm';

export default function LoginPage(): JSX.Element {
  return (
    <AppShell>
      <Head>
        <title>Sign in — CloudJava VNC</title>
      </Head>

      <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12 sm:py-20">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Sign in</h1>
        <p className="mt-2 text-[13px] text-slate-400">
          Your instances keep running while you are away.
        </p>

        <div className="panel mt-6 p-5 sm:p-6">
          <AuthForm mode="login" />
        </div>

        <p className="mt-5 text-center font-mono text-[11px] text-slate-600">
          cookie: cj_session · httpOnly · sameSite
        </p>
      </div>
    </AppShell>
  );
}
