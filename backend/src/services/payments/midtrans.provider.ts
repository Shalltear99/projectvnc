/**
 * Midtrans (Snap) provider.
 *
 * Webhook authenticity: Midtrans signs with
 *   SHA512(order_id + status_code + gross_amount + serverKey)
 * and ships the digest as `signature_key`. The concatenation must use the values
 * EXACTLY as they appear in the payload (gross_amount is a string like
 * "15000.00"), so we never re-format numbers before hashing.
 */
import { createHash } from 'node:crypto';
import { config } from '../../config';
import { logger } from '../../logger';
import {
  PAYMENT_WINDOW_MINUTES,
  toAmountIdr,
  type CheckoutInput,
  type CheckoutResult,
  type PaymentProvider,
  type WebhookHeaders,
  type WebhookResult,
} from './types';

const SNAP_SANDBOX = 'https://app-sandbox.midtrans.com/snap/v1/transactions';
const SNAP_PRODUCTION = 'https://app.midtrans.com/snap/v1/transactions';

interface SnapResponse {
  token?: string;
  redirect_url?: string;
}

export class MidtransProvider implements PaymentProvider {
  readonly name = 'midtrans' as const;

  constructor(private readonly serverKey: string) {
    if (!serverKey) {
      throw new Error(
        '[payments] PAYMENT_PROVIDER=midtrans requires MIDTRANS_SERVER_KEY; refusing to start without credentials',
      );
    }
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const orderId = input.order.providerRef || input.order.id;
    const expiresAt = new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000).toISOString();
    const payload = {
      transaction_details: { order_id: orderId, gross_amount: input.plan.priceIdr },
      item_details: [
        { id: input.plan.id, price: input.plan.priceIdr, quantity: 1, name: input.plan.name.slice(0, 50) },
      ],
      customer_details: { email: input.user.email },
      expiry: { unit: 'minutes', duration: PAYMENT_WINDOW_MINUTES },
    };

    const res = await fetch(config.isProd ? SNAP_PRODUCTION : SNAP_SANDBOX, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        // Midtrans uses HTTP Basic with the server key as the username.
        authorization: `Basic ${Buffer.from(`${this.serverKey}:`).toString('base64')}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      logger.error({ status: res.status, detail }, 'midtrans snap request failed');
      throw Object.assign(new Error('payment gateway rejected the checkout request'), {
        status: 502,
        code: 'PAYMENT_GATEWAY_ERROR',
      });
    }

    const body = (await res.json()) as SnapResponse;
    if (!body.redirect_url) {
      throw Object.assign(new Error('payment gateway returned no redirect_url'), {
        status: 502,
        code: 'PAYMENT_GATEWAY_ERROR',
      });
    }
    return { providerRef: orderId, checkoutUrl: body.redirect_url, expiresAt };
  }

  verifyWebhook(_headers: WebhookHeaders, rawBody: Buffer): WebhookResult {
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

    const orderId = typeof body.order_id === 'string' ? body.order_id : '';
    const statusCode = typeof body.status_code === 'string' ? body.status_code : '';
    // Keep the literal string: "15000.00" and "15000" hash differently.
    const grossAmount = typeof body.gross_amount === 'string'
      ? body.gross_amount
      : typeof body.gross_amount === 'number'
        ? String(body.gross_amount)
        : '';
    const signature = typeof body.signature_key === 'string' ? body.signature_key : '';

    if (!orderId || !statusCode || !grossAmount || !signature) {
      return { ok: false, providerRef: orderId, status: 'failed', amountIdr: 0, reason: 'missing signature fields' };
    }

    const expected = createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${this.serverKey}`)
      .digest('hex');
    // Digests are public-length, so a plain comparison of equal-length hex is
    // not a meaningful oracle; timing-safe here would add no security.
    if (signature.toLowerCase() !== expected.toLowerCase()) {
      return { ok: false, providerRef: orderId, status: 'failed', amountIdr: 0, reason: 'signature mismatch' };
    }

    const transactionStatus = typeof body.transaction_status === 'string' ? body.transaction_status : '';
    const fraudStatus = typeof body.fraud_status === 'string' ? body.fraud_status : '';
    const amountIdr = toAmountIdr(grossAmount);

    if (transactionStatus === 'capture' && fraudStatus !== 'accept') {
      // Authorised but held for fraud review: authentic, not settled.
      return { ok: true, providerRef: orderId, status: 'failed', amountIdr, reason: 'capture pending fraud review', ignored: true };
    }
    if (transactionStatus === 'settlement' || (transactionStatus === 'capture' && fraudStatus === 'accept')) {
      return { ok: true, providerRef: orderId, status: 'paid', amountIdr };
    }
    if (transactionStatus === 'pending') {
      return { ok: true, providerRef: orderId, status: 'failed', amountIdr, reason: 'transaction pending', ignored: true };
    }
    if (transactionStatus === 'expire') {
      return { ok: true, providerRef: orderId, status: 'expired', amountIdr };
    }
    return { ok: true, providerRef: orderId, status: 'failed', amountIdr, reason: `transaction_status=${transactionStatus}` };
  }
}
