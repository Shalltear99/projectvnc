import Head from 'next/head';
import { AppShell } from '@/components/AppShell';
import { AuthForm } from '@/components/AuthForm';

export default function RegisterPage(): JSX.Element {
  return (
    <AppShell>
      <Head>
        <title>Create account — CloudJava VNC</title>
      </Head>

      <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12 sm:py-20">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Create account</h1>
        <p className="mt-2 text-[13px] text-slate-400">
          Email and password. You pick a plan and a JDK after signing in.
        </p>

        <div className="panel mt-6 p-5 sm:p-6">
          <AuthForm mode="register" />
        </div>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-600">
          Passwords are hashed server-side (bcrypt/argon2). We never store a VNC password in the
          browser — each viewer mount gets a short-lived ticket.
        </p>
      </div>
    </AppShell>
  );
}
