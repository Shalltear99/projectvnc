/**
 * Xendit provider (Invoice API + callback webhooks).
 *
 * Webhook authenticity is a shared-secret header, not a body signature:
 * Xendit sends `x-callback-token`, which must equal our configured callback
 * token. Comparison is timing-safe because the header is attacker-controlled
 * and a byte-by-byte early exit would leak the token prefix.
 */
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

const INVOICE_URL = 'https://api.xendit.co/v2/invoices';

interface InvoiceResponse {
  id?: string;
  invoice_url?: string;
}

export class XenditProvider implements PaymentProvider {
  readonly name = 'xendit' as const;

  constructor(
    private readonly callbackToken: string,
    private readonly apiKey: string,
  ) {
    if (!callbackToken) {
      throw new Error(
        '[payments] PAYMENT_PROVIDER=xendit requires XENDIT_CALLBACK_TOKEN; refusing to start without credentials',
      );
    }
    if (!apiKey) {
      throw new Error(
        '[payments] PAYMENT_PROVIDER=xendit requires XENDIT_API_KEY for invoice creation; refusing to start without credentials',
      );
    }
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const expiresAt = new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000).toISOString();
    const res = await fetch(INVOICE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Xendit: API key as Basic username, empty password.
        authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
      },
      body: JSON.stringify({
        external_id: input.order.providerRef || input.order.id,
        amount: input.plan.priceIdr,
        description: `CloudJava VNC — ${input.plan.name}`,
        payer_email: input.user.email,
        invoice_duration: PAYMENT_WINDOW_MINUTES * 60,
        currency: 'IDR',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      logger.error({ status: res.status, detail }, 'xendit invoice request failed');
      throw Object.assign(new Error('payment gateway rejected the checkout request'), {
        status: 502,
        code: 'PAYMENT_GATEWAY_ERROR',
      });
    }

    const body = (await res.json()) as InvoiceResponse;
    if (!body.invoice_url) {
      throw Object.assign(new Error('payment gateway returned no invoice_url'), {
        status: 502,
        code: 'PAYMENT_GATEWAY_ERROR',
      });
    }
    return {
      // Must match what the webhook reports back (external_id): the order is
      // looked up by this value, so the invoice id would break reconciliation.
      providerRef: input.order.providerRef || input.order.id,
      checkoutUrl: body.invoice_url,
      expiresAt,
    };
  }

  verifyWebhook(headers: WebhookHeaders, rawBody: Buffer): WebhookResult {
    const provided = header(headers, 'x-callback-token');
    if (!provided || !safeEqual(provided, this.callbackToken)) {
      return { ok: false, providerRef: '', status: 'failed', amountIdr: 0, reason: 'invalid callback token' };
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

    // Our order reference travels in external_id; Xendit's own id is `id`.
    const providerRef = typeof body.external_id === 'string' && body.external_id
      ? body.external_id
      : typeof body.id === 'string'
        ? body.id
        : '';
    if (!providerRef) {
      return { ok: false, providerRef: '', status: 'failed', amountIdr: 0, reason: 'external_id missing' };
    }

    const status = typeof body.status === 'string' ? body.status.toUpperCase() : '';
    const amountIdr = toAmountIdr(body.paid_amount ?? body.amount);
    switch (status) {
      case 'PAID':
      case 'SETTLED':
        return { ok: true, providerRef, status: 'paid', amountIdr };
      case 'EXPIRED':
        return { ok: true, providerRef, status: 'expired', amountIdr };
      case 'PENDING':
        return { ok: true, providerRef, status: 'failed', amountIdr, reason: 'invoice pending', ignored: true };
      default:
        return { ok: true, providerRef, status: 'failed', amountIdr, reason: `status=${status || 'unknown'}` };
    }
  }
}

/** Xendit's API key has no slot in the validated config schema; read it once. */
export function xenditApiKeyFromEnv(): string {
  return process.env.XENDIT_API_KEY ?? '';
}
