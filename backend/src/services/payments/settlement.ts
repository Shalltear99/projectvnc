/**
 * Webhook settlement — the single code path that may move an order to `paid`.
 *
 * Both the public webhook route and the development mock-pay endpoint funnel
 * through here, so signature verification, amount checking and idempotency are
 * exercised identically in every environment.
 *
 * Order of checks is deliberate:
 *   1. provider is the configured one (a webhook for an unconfigured provider is
 *      not authentic, whatever its body says);
 *   2. signature over raw bytes;
 *   3. order lookup by provider reference;
 *   4. amount matches what we quoted — an authentic but underpaid callback must
 *      not provision anything;
 *   5. already-paid orders are acknowledged without re-publishing ORDER_PAID.
 */
import { eventBus } from '../../events/bus';
import { logger } from '../../logger';
import { getStore } from '../../db/store';
import { config } from '../../config';
import { getPaymentProvider } from './index';
import type { PaymentProviderName, WebhookHeaders } from './types';

export interface WebhookOutcome {
  statusCode: number;
  body: Record<string, unknown>;
}

const respond = (statusCode: number, body: Record<string, unknown>): WebhookOutcome => ({ statusCode, body });

export async function handleProviderWebhook(
  providerName: string,
  headers: WebhookHeaders,
  rawBody: Buffer,
): Promise<WebhookOutcome> {
  if (providerName !== config.payments.provider) {
    logger.warn({ providerName, configured: config.payments.provider }, 'webhook for unconfigured provider');
    return respond(404, { error: { code: 'UNKNOWN_PROVIDER', message: 'unknown payment provider' } });
  }

  const provider = getPaymentProvider(providerName as PaymentProviderName);
  const verdict = provider.verifyWebhook(headers, rawBody);
  if (!verdict.ok) {
    logger.warn({ provider: providerName, reason: verdict.reason }, 'rejected webhook: bad signature');
    return respond(401, { error: { code: 'INVALID_SIGNATURE', message: 'webhook signature verification failed' } });
  }

  if (verdict.ignored) {
    logger.info({ provider: providerName, providerRef: verdict.providerRef, reason: verdict.reason }, 'webhook ignored (non-terminal)');
    return respond(200, { received: true, ignored: true });
  }

  const store = getStore();
  const order = await store.findOrderByProviderRef(providerName, verdict.providerRef);
  if (!order) {
    // Acknowledge anyway: a non-2xx makes gateways retry forever for references
    // we never issued (replays, probes, or orders pruned from another node).
    logger.warn({ provider: providerName, providerRef: verdict.providerRef }, 'webhook for unknown order reference');
    return respond(200, { received: true, unknownReference: true });
  }

  if (Number.isFinite(verdict.amountIdr) && verdict.amountIdr !== order.amountIdr) {
    logger.error(
      { orderId: order.id, expected: order.amountIdr, received: verdict.amountIdr },
      'webhook amount mismatch — order not settled',
    );
    await eventBus.publish('SECURITY_ALERT', {
      instanceId: '',
      kind: 'payment_amount_mismatch',
      detail: `order ${order.id}: expected ${order.amountIdr}, webhook reported ${verdict.amountIdr}`,
    });
    return respond(400, { error: { code: 'AMOUNT_MISMATCH', message: 'webhook amount does not match the order' } });
  }

  if (verdict.status !== 'paid') {
    // failed / expired are terminal for the order but never provision anything.
    if (order.status === 'pending') {
      await store.updateOrder(order.id, { status: verdict.status });
      logger.info({ orderId: order.id, status: verdict.status }, 'order closed without payment');
    }
    return respond(200, { received: true, status: verdict.status });
  }

  if (order.status === 'paid') {
    // Idempotency: gateways retry. Never provision twice for one payment.
    logger.info({ orderId: order.id }, 'duplicate paid webhook ignored');
    return respond(200, { received: true, duplicate: true });
  }

  const updated = await store.updateOrder(order.id, {
    status: 'paid',
    paidAt: new Date().toISOString(),
  });
  if (!updated) {
    logger.error({ orderId: order.id }, 'order vanished during settlement');
    return respond(500, { error: { code: 'SETTLEMENT_FAILED', message: 'order could not be settled' } });
  }

  // Provisioning is asynchronous: the HTTP response must return immediately, the
  // ProvisionerAgent consumes the event and does the slow Docker work.
  await eventBus.publish('ORDER_PAID', {
    orderId: updated.id,
    userId: updated.userId,
    planId: updated.planId,
  });

  logger.info({ orderId: updated.id, userId: updated.userId }, 'order paid, ORDER_PAID published');
  return respond(200, { received: true, settled: true });
}
