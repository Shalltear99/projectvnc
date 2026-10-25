/**
 * Mock provider — the development and CI settlement path.
 *
 * It is NOT a stub: webhooks are signed with HMAC-SHA256 over the exact raw body
 * using `MOCK_PAYMENT_SECRET`, and verification is mandatory. That keeps the
 * webhook route, the idempotency logic and the settlement state machine under
 * test without a payment gateway account (docs/tasks.md Task 4.2).
 */
import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { config } from '../../config';
import {
  PAYMENT_WINDOW_MINUTES,
  header,
  safeEqual,
  toAmountIdr,
  type CheckoutInput,
  type CheckoutResult,
  type PaymentProvider,
  type WebhookHeaders,
  type WebhookResult,
} from './types';

const SIGNATURE_HEADER = 'x-mock-signature';

export function signMockBody(rawBody: Buffer, secret: string = config.payments.mockSecret): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    // Deterministic, unique and traceable back to the order it settles.
    const providerRef = `mock_${input.order.id}_${randomUUID().slice(0, 8)}`;
    const expiresAt = new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000).toISOString();
    return {
      providerRef,
      // Development-only URL, shaped like a gateway redirect: it carries the
      // provider reference and nothing else. `input.order` is a provisional
      // object whose id is never persisted, so embedding order.id here would
      // point the settlement page at an order that does not exist.
      //
      // Same-origin deployments get a RELATIVE url on purpose: an absolute one
      // would pin the redirect to whatever hostname the server was configured
      // with, and a phone on a different host (tailnet IP vs ts.net name) would
      // be sent somewhere it cannot reach.
      checkoutUrl: config.publicBaseUrl
        ? `${config.publicBaseUrl}/checkout/mock?ref=${encodeURIComponent(providerRef)}`
        : `/checkout/mock?ref=${encodeURIComponent(providerRef)}`,
      expiresAt,
    };
  }

  verifyWebhook(headers: WebhookHeaders, rawBody: Buffer): WebhookResult {
    const provided = header(headers, SIGNATURE_HEADER);
    if (!provided) {
      return { ok: false, providerRef: '', status: 'failed', amountIdr: 0, reason: 'missing signature header' };
    }
    const expected = signMockBody(rawBody);
    if (!safeEqual(provided, expected)) {
      return { ok: false, providerRef: '', status: 'failed', amountIdr: 0, reason: 'signature mismatch' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { ok: false, providerRef: '', status: 'failed', amountIdr: 0, reason: 'body is not JSON' };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, providerRef: '', status: 'failed', amountIdr: 0, reason: 'body is not an object' };
    }
    const body = parsed as Record<string, unknown>;
    const providerRef = typeof body.providerRef === 'string' ? body.providerRef : '';
    if (!providerRef) {
      return { ok: false, providerRef: '', status: 'failed', amountIdr: 0, reason: 'providerRef missing' };
    }
    const rawStatus = typeof body.status === 'string' ? body.status : '';
    const status = rawStatus === 'paid' || rawStatus === 'failed' || rawStatus === 'expired' ? rawStatus : null;
    if (!status) {
      return { ok: false, providerRef, status: 'failed', amountIdr: 0, reason: `unknown status "${rawStatus}"` };
    }
    return { ok: true, providerRef, status, amountIdr: toAmountIdr(body.amountIdr) };
  }
}

/**
 * Build a signed settlement body. Used by POST /api/payments/:orderId/mock-pay
 * so development settlement travels through the same verification path a real
 * gateway would — never by writing order state directly.
 */
export function buildMockWebhookBody(
  providerRef: string,
  amountIdr: number,
  status: 'paid' | 'failed' | 'expired' = 'paid',
): { rawBody: Buffer; headers: WebhookHeaders } {
  const rawBody = Buffer.from(JSON.stringify({ providerRef, amountIdr, status }), 'utf8');
  return { rawBody, headers: { [SIGNATURE_HEADER]: signMockBody(rawBody) } };
}
