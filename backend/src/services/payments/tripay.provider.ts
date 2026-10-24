/**
 * Tripay provider (closed payment / hosted checkout).
 *
 * Webhook authenticity: HMAC-SHA256 over the RAW request body keyed with the
 * merchant private key, delivered in `X-Callback-Signature`. Hashing the parsed
 * object instead of the exact bytes is the classic way to get this wrong — key
 * order and whitespace would change the digest — so the route mounts
 * express.raw() and this method only ever sees the untouched Buffer.
 */
import { createHmac } from 'node:crypto';
import { logger } from '../../logger';
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

const CLOSED_PAYMENT_URL = 'https://tripay.co.id/api/transaction/create';

interface TripayResponse {
  success?: boolean;
  message?: string;
  data?: { reference?: string; checkout_url?: string; pay_url?: string };
}

export class TripayProvider implements PaymentProvider {
  readonly name = 'tripay' as const;

  constructor(
    private readonly privateKey: string,
    private readonly merchantCode: string,
    private readonly apiKey: string,
  ) {
    if (!privateKey) {
      throw new Error(
        '[payments] PAYMENT_PROVIDER=tripay requires TRIPAY_PRIVATE_KEY; refusing to start without credentials',
      );
    }
    if (!merchantCode) {
      throw new Error(
        '[payments] PAYMENT_PROVIDER=tripay requires TRIPAY_MERCHANT_CODE; refusing to start without credentials',
      );
    }
    if (!apiKey) {
      throw new Error(
        '[payments] PAYMENT_PROVIDER=tripay requires TRIPAY_API_KEY for transaction creation; refusing to start without credentials',
      );
    }
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const merchantRef = input.order.providerRef || input.order.id;
    const amount = input.plan.priceIdr;
    // Tripay requires a per-transaction signature: HMAC-SHA256 of
    // merchant_code + merchant_ref + amount, keyed with the private key.
    const signature = createHmac('sha256', this.privateKey)
      .update(`${this.merchantCode}${merchantRef}${amount}`)
      .digest('hex');

    const res = await fetch(CLOSED_PAYMENT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        method: 'QRIS',
        merchant_ref: merchantRef,
        amount,
        customer_name: input.user.email.split('@')[0] ?? 'customer',
        customer_email: input.user.email,
        order_items: [{ sku: input.plan.id, name: input.plan.name, price: amount, quantity: 1 }],
        expired_time: Math.floor(Date.now() / 1000) + PAYMENT_WINDOW_MINUTES * 60,
        signature,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      logger.error({ status: res.status, detail }, 'tripay transaction request failed');
      throw Object.assign(new Error('payment gateway rejected the checkout request'), {
        status: 502,
        code: 'PAYMENT_GATEWAY_ERROR',
      });
    }

    const body = (await res.json()) as TripayResponse;
    const checkoutUrl = body.data?.checkout_url ?? body.data?.pay_url;
    if (!body.success || !checkoutUrl) {
      logger.error({ message: body.message }, 'tripay rejected transaction');
      throw Object.assign(new Error('payment gateway rejected the checkout request'), {
        status: 502,
        code: 'PAYMENT_GATEWAY_ERROR',
      });
    }

    return {
      // merchant_ref is our reference and is what the callback echoes back.
      providerRef: merchantRef,
      checkoutUrl,
      expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000).toISOString(),
    };
  }

  verifyWebhook(headers: WebhookHeaders, rawBody: Buffer): WebhookResult {
    const provided = header(headers, 'x-callback-signature');
    if (!provided) {
      return { ok: false, providerRef: '', status: 'failed', amountIdr: 0, reason: 'missing X-Callback-Signature' };
    }
    const expected = createHmac('sha256', this.privateKey).update(rawBody).digest('hex');
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

    const providerRef = typeof body.merchant_ref === 'string' ? body.merchant_ref : '';
    if (!providerRef) {
      return { ok: false, providerRef: '', status: 'failed', amountIdr: 0, reason: 'merchant_ref missing' };
    }

    const status = typeof body.status === 'string' ? body.status.toUpperCase() : '';
    const amountIdr = toAmountIdr(body.total_amount ?? body.amount);
    switch (status) {
      case 'PAID':
        return { ok: true, providerRef, status: 'paid', amountIdr };
      case 'EXPIRED':
        return { ok: true, providerRef, status: 'expired', amountIdr };
      case 'FAILED':
        return { ok: true, providerRef, status: 'failed', amountIdr };
      case 'UNPAID':
        return { ok: true, providerRef, status: 'failed', amountIdr, reason: 'invoice unpaid', ignored: true };
      default:
        return { ok: true, providerRef, status: 'failed', amountIdr, reason: `status=${status || 'unknown'}` };
    }
  }
}

/** Tripay's API key has no slot in the validated config schema; read it once. */
export function tripayApiKeyFromEnv(): string {
  return process.env.TRIPAY_API_KEY ?? '';
}
