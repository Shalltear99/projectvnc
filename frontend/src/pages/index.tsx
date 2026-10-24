import Head from 'next/head';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { ButtonLink } from '@/components/Button';
import { PLANS, formatDuration, formatIdr } from '@/lib/plans';

const FEATURES = [
  {
    title: 'Isolated containers',
    body: 'Every instance is its own unprivileged Docker container: OpenJDK, TigerVNC and Openbox, capped at the cgroup level.',
    meta: '--cap-drop=ALL · user 1000:1000',
  },
  {
    title: 'Browser-native VNC',
    body: 'noVNC renders the remote desktop straight into a canvas. No client install, no Java runtime on your machine.',
    meta: 'wss:// · nginx stream proxy',
  },
  {
    title: 'Pick your JDK',
    body: 'OpenJDK 8, 11, 17 or 21 with J2ME emulators and launchers preinstalled, ready before the page finishes loading.',
    meta: 'provisioning < 5s',
  },
  {
    title: 'Built for 24/7 runs',
    body: 'Instances keep running while you close the tab. Metrics stream to the dashboard so you can watch CPU and RAM.',
    meta: 'cpu / ram · 3s poll',
  },
];

export default function LandingPage(): JSX.Element {
  return (
    <AppShell>
      <Head>
        <title>CloudJava VNC — Java desktops in the browser</title>
      </Head>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/5">
        <div aria-hidden="true" className="grid-backdrop absolute inset-0 opacity-40" />
        <div className="relative mx-auto w-full max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-slate-400">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-ok" />
            OpenJDK 8 / 11 / 17 / 21 · noVNC 1.5
          </p>

          <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
            A Java desktop
            <span className="text-slate-500">, </span>
            <span className="bg-gradient-to-r from-accent to-indigo-300 bg-clip-text text-transparent">
              one click away
            </span>
            .
          </h1>

          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-slate-400 sm:text-base">
            CloudJava VNC rents you an isolated Java environment that streams into your browser.
            Run retro Java games, J2ME emulators or a 24/7 bot — nothing to install, nothing to
            keep patched on your own machine.
          </p>

          <div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <ButtonLink href="/register" size="lg">
              Create an account
            </ButtonLink>
            <ButtonLink href="/login" size="lg" variant="secondary">
              Sign in
            </ButtonLink>
            <span className="sm:ml-2 font-mono text-[11px] text-slate-500">
              from {formatIdr(15000)} / day
            </span>
          </div>

          {/* Terminal-ish proof panel */}
          <div className="mt-12 overflow-hidden rounded-xl border border-white/10 bg-[#0b1120]/90 shadow-panel">
            <div className="flex items-center gap-1.5 border-b border-white/5 px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                session
              </span>
            </div>
            <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[11.5px] leading-relaxed text-slate-400 sm:text-xs">
{`$ cloudjava instance create --plan weekly --jdk 17
  provisioning  container=cj-8f21  image=cloudjava/jdk17-vnc
  ready         1.9s  ws=wss://vnc.cloudjava.id/vnc-stream/8f21/websockify
$ open /instances/8f21
  rfb           connected  1024x768x24   scale=on`}
            </pre>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <h2 className="text-xs font-medium uppercase tracking-widest text-slate-500">
          What you get
        </h2>
        <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-white/5 bg-white/5 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="bg-surface-base p-5 sm:p-6">
              <h3 className="text-[15px] font-semibold text-white">{feature.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{feature.body}</p>
              <p className="mt-3 font-mono text-[11px] text-slate-600">{feature.meta}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="border-t border-white/5">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Plans
              </h2>
              <p className="mt-2 text-[13px] text-slate-400">
                Prepaid runtime. The clock starts when the container is provisioned.
              </p>
            </div>
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-600">
              IDR · incl. worker
            </span>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <article
                key={plan.id}
                className={[
                  'relative flex flex-col rounded-xl border p-5',
                  plan.featured
                    ? 'border-accent/40 bg-surface-card shadow-glow'
                    : 'border-white/5 bg-surface-card/60',
                ].join(' ')}
              >
                {plan.featured ? (
                  <span className="absolute -top-2.5 left-5 rounded-full border border-accent/40 bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    Popular
                  </span>
                ) : null}

                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                  {plan.name}
                </h3>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-3xl font-semibold tracking-tight text-white">
                    {formatIdr(plan.priceIdr)}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    /{formatDuration(plan.durationMinutes)}
                  </span>
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{plan.blurb}</p>

                <ul className="mt-4 space-y-1.5 border-t border-white/5 pt-4">
                  {plan.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[12.5px] text-slate-400">
                      <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="mt-5">
                  <ButtonLink
                    href="/register"
                    block
                    variant={plan.featured ? 'primary' : 'secondary'}
                  >
                    Choose {plan.name.toLowerCase()}
                  </ButtonLink>
                </div>
              </article>
            ))}
          </div>

          <p className="mt-6 text-[12px] text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="text-accent underline decoration-accent/40 underline-offset-2">
              Sign in
            </Link>{' '}
            and your instances are waiting.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
