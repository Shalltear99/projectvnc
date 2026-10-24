/**
 * Payment routes: provider webhooks + a development-only settlement shortcut.
 *
 * The webhook is mounted with express.raw() (see app.ts) so the signature is
 * computed over the exact bytes the provider sent. Any body parser that
 * re-serialises JSON would invalidate Tripay/Midtrans signatures.
 */
import { Router } from 'express';
import { AppError, asyncHandler } from '../errors';
import { getStore } from '../db/store';
import { requireAuth } from '../middleware/auth';
import { buildMockWebhookBody } from '../services/payments/mock.provider';
import { handleProviderWebhook } from '../services/payments/settlement';
import { isMockProvider } from '../services/payments';
import { config } from '../config';

/** Mounted at /api/webhooks — public by necessity, authenticated by signature. */
export const webhookRouter = Router();

webhookRouter.post(
  '/:provider',
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      // Guards against a future mount that forgets express.raw(): a parsed object
      // here would mean we were about to verify a signature over the wrong bytes.
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'webhook endpoint requires a raw request body');
    }
    const outcome = await handleProviderWebhook(req.params.provider, req.headers, req.body);
    res.status(outcome.statusCode).json(outcome.body);
  }),
);

/** Mounted at /api/payments. */
const router = Router();

/**
 * Simulates the gateway calling us back, but only by producing a correctly
 * signed payload and pushing it through the real verification path — so
 * development exercises signature checking and idempotency, not a bypass.
 */
router.post(
  '/:orderId/mock-pay',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isMockProvider()) {
      throw new AppError(404, 'NOT_FOUND', 'mock payments are disabled for the configured provider');
    }
    const user = req.user;
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'authentication required');

    const store = getStore();
    // The settlement page is reached by whatever the gateway redirect carried:
    // either our order id (dashboard inline flow) or the provider reference
    // (gateway-style redirect). Accept both, and never trust either as
    // authorisation — ownership is checked below.
    const key = req.params.orderId;
    let order = await store.getOrder(key);
    if (!order) {
      order = await store.findOrderByProviderRef(config.payments.provider, key);
    }
    if (!order || order.userId !== user.id) {
      throw new AppError(404, 'NOT_FOUND', 'order not found');
    }

    if (order.status === 'paid') {
      res.json({ orderId: order.id, status: order.status, alreadyPaid: true });
      return;
    }

    const { rawBody, headers } = buildMockWebhookBody(order.providerRef, order.amountIdr, 'paid');
    const outcome = await handleProviderWebhook('mock', headers, rawBody);
    if (outcome.statusCode >= 400) {
      // Surface the same contract the gateway would see; never a silent success.
      res.status(outcome.statusCode).json(outcome.body);
      return;
    }

    const settled = await store.getOrder(order.id);
    res.json({
      orderId: order.id,
      status: settled?.status ?? order.status,
      provider: config.payments.provider,
      settled: settled?.status === 'paid',
    });
  }),
);

export default router;
