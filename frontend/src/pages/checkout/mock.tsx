import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { Button } from '../../components/Button';
import { ApiError, settleMockOrder } from '../../lib/api';

/**
 * Development-only settlement screen.
 *
 * The mock payment provider hands out `checkoutUrl = /checkout/mock?ref=<providerRef>`
 * so the flow looks like a real gateway redirect. There is no order id in that
 * URL (gateways never expose your internal ids), so this page settles by
 * reference through the API's mock-pay endpoint, which resolves ref -> order.
 *
 * In production the configured provider returns its own hosted page and this
 * component is never reached.
 */
export default function MockCheckoutPage() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'paying' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  const reference = typeof router.query.ref === 'string' ? router.query.ref : '';
  const orderId = typeof router.query.orderId === 'string' ? router.query.orderId : '';

  useEffect(() => {
    // Nothing to do until the router has hydrated its query.
    if (!router.isReady) return;
    if (!reference && !orderId) {
      setState('error');
      setMessage('This checkout link is missing its payment reference.');
    }
  }, [router.isReady, reference, orderId]);

  const settle = async (): Promise<void> => {
    setState('paying');
    try {
      // The reference form is what the gateway URL carries; the dashboard passes
      // the order id directly. Prefer the id when present.
      await settleMockOrder(orderId || reference);
      setState('done');
      setMessage('Payment settled. Your instance is provisioning.');
      setTimeout(() => void router.push('/dashboard'), 1500);
    } catch (caught: unknown) {
      setState('error');
      setMessage(
        caught instanceof ApiError
          ? caught.message
          : 'Could not settle the payment. Check the API logs.',
      );
    }
  };

  return (
    <AppShell>
      <Head>
        <title>Checkout — CloudJava VNC</title>
      </Head>
      <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-6">
        <div className="rounded-xl border border-slate-700/60 bg-surface-card p-8">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Mock gateway</p>
          <h1 className="mt-3 text-2xl font-semibold text-white">Confirm payment</h1>
          <p className="mt-2 text-sm text-slate-400">
            This is the development payment provider. No money moves and no card is
            involved — settling here publishes the same{' '}
            <span className="font-mono text-slate-300">ORDER_PAID</span> event a real
            gateway webhook would.
          </p>

          {reference ? (
            <p className="mt-4 break-all font-mono text-xs text-slate-500">ref: {reference}</p>
          ) : null}

          <div className="mt-6 flex items-center gap-3">
            <Button
              onClick={() => void settle()}
              disabled={state === 'paying' || state === 'done' || !router.isReady}
            >
              {state === 'paying' ? 'Settling…' : state === 'done' ? 'Paid' : 'Pay now'}
            </Button>
            <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white">
              Cancel
            </Link>
          </div>

          {message ? (
            <p
              className={
                state === 'error'
                  ? 'mt-4 text-sm text-status-bad'
                  : 'mt-4 text-sm text-status-ok'
              }
            >
              {message}
            </p>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}
