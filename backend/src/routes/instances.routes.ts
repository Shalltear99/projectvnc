/**
 * Instance lifecycle API.
 *
 * Rules that hold on every route here:
 *   * the caller only ever sees their own rows — a foreign id is a 404, never a
 *     403, so ids cannot be probed for existence;
 *   * no response contains `vncPassword` except GET /:id/connect, which returns
 *     it once to the authenticated owner (websockify is a transparent tunnel and
 *     cannot inject RFB credentials, so the client genuinely needs both the
 *     signed stream ticket and the RFB password);
 *   * ports are never assigned here — the allocator owns them, and provisioning
 *     only happens from a payment webhook, never from a request body.
 */
import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { getStore } from '../db/store';
import { eventBus } from '../events/bus';
import { AppError, asyncHandler } from '../errors';
import { requireAuth } from '../middleware/auth';
import { findPlan } from '../plans';
import { getDocker } from '../services/docker.service';
import { toInstanceView } from '../services/instance-view';
import { getMetricsAgent } from '../agents/metrics.agent';
import { getPaymentProvider } from '../services/payments';
import { getPortAllocator } from '../services/ports';
import { getProxyRouter } from '../services/proxy-router';
import { signVncToken } from '../services/vnc-token';
import type { Instance, Order, User } from '../types';

const router = Router();

const LIVE_STATUSES: Instance['status'][] = ['provisioning', 'running', 'stopped'];

const createSchema = z.object({
  planId: z.string().min(1).max(64),
});

const actionSchema = z.enum(['start', 'stop', 'restart', 'reset']);

router.use(requireAuth);

function requireUser(req: Request): User {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'authentication required');
  return req.user;
}

/** 404 (not 403) for a foreign instance: ownership must not be inferable. */
async function loadOwned(instanceId: string, userId: string): Promise<Instance> {
  const instance = await getStore().getInstance(instanceId);
  if (!instance || instance.userId !== userId) {
    throw new AppError(404, 'NOT_FOUND', 'instance not found');
  }
  return instance;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const instances = await getStore().listInstancesByUser(user.id);
    res.json({ instances: instances.map(toInstanceView) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const instance = await loadOwned(req.params.id, user.id);
    res.json({ instance: toInstanceView(instance) });
  }),
);

/**
 * Creates a PENDING ORDER, not an instance. Provisioning is triggered only by
 * the payment webhook, so a caller cannot mint containers without paying.
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { planId } = createSchema.parse(req.body);
    const plan = findPlan(planId);
    if (!plan) throw new AppError(404, 'PLAN_NOT_FOUND', 'unknown plan');

    const store = getStore();
    const mine = await store.listInstancesByUser(user.id);
    const live = mine.filter((i) => LIVE_STATUSES.includes(i.status));
    if (live.length >= config.instances.maxPerUser) {
      throw new AppError(
        409,
        'INSTANCE_LIMIT_REACHED',
        `you already have ${live.length} active instance(s); the limit is ${config.instances.maxPerUser}`,
      );
    }

    const provider = getPaymentProvider();
    // Provisional order: the provider needs our reference before we persist the
    // row (Midtrans/Tripay echo it back in the webhook as order_id/merchant_ref).
    const reference = randomUUID();
    const provisional: Order = {
      id: reference,
      userId: user.id,
      planId: plan.id,
      provider: provider.name,
      providerRef: reference,
      status: 'pending',
      amountIdr: plan.priceIdr,
      createdAt: new Date().toISOString(),
      paidAt: null,
    };

    const checkout = await provider.createCheckout({ order: provisional, plan, user });
    const order = await store.createOrder({
      userId: user.id,
      planId: plan.id,
      provider: provider.name,
      providerRef: checkout.providerRef,
      amountIdr: plan.priceIdr,
    });

    res.status(201).json({
      orderId: order.id,
      provider: provider.name,
      providerRef: order.providerRef,
      amountIdr: order.amountIdr,
      checkoutUrl: checkout.checkoutUrl,
      expiresAt: checkout.expiresAt,
    });
  }),
);

router.post(
  '/:id/:action',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const action = actionSchema.parse(req.params.action);
    const instance = await loadOwned(req.params.id, user.id);
    const store = getStore();
    const docker = getDocker();

    switch (action) {
      case 'start': {
        if (instance.status === 'running') {
          res.json({ instance: toInstanceView(instance) });
          return;
        }
        if (instance.status !== 'stopped' || !instance.containerId) {
          throw new AppError(409, 'INVALID_STATE', `cannot start an instance that is ${instance.status}`);
        }
        await docker.start(instance.containerId);
        const updated = await store.updateInstance(instance.id, {
          status: 'running',
          lastActivityAt: new Date().toISOString(),
        });
        res.json({ instance: toInstanceView(updated ?? instance) });
        return;
      }
      case 'stop': {
        if (instance.status === 'stopped') {
          res.json({ instance: toInstanceView(instance) });
          return;
        }
        if (instance.status !== 'running' || !instance.containerId) {
          throw new AppError(409, 'INVALID_STATE', `cannot stop an instance that is ${instance.status}`);
        }
        await docker.stop(instance.containerId);
        // Ports stay reserved while stopped: the container still exists and will
        // be started again on the same websockify port.
        const updated = await store.updateInstance(instance.id, { status: 'stopped' });
        res.json({ instance: toInstanceView(updated ?? instance) });
        return;
      }
      case 'restart': {
        if (!instance.containerId) {
          throw new AppError(409, 'INVALID_STATE', 'instance has no container');
        }
        if (instance.status !== 'running' && instance.status !== 'stopped') {
          throw new AppError(409, 'INVALID_STATE', `cannot restart an instance that is ${instance.status}`);
        }
        await docker.restart(instance.containerId);
        const updated = await store.updateInstance(instance.id, {
          status: 'running',
          lastActivityAt: new Date().toISOString(),
        });
        res.json({ instance: toInstanceView(updated ?? instance) });
        return;
      }
      case 'reset': {
        // Reset destroys the filesystem state, so the container is recreated from
        // the image with a NEW VNC password by the ProvisionerAgent.
        if (instance.status === 'expired' || instance.status === 'failed') {
          throw new AppError(409, 'INVALID_STATE', `cannot reset an instance that is ${instance.status}`);
        }
        // Mark first, then publish: the rebuild can finish before publish()
        // returns (the in-process bus awaits handlers), and writing 'provisioning'
        // afterwards would overwrite the fresh 'running' state.
        const updated = await store.updateInstance(instance.id, { status: 'provisioning' });
        // Fire-and-forget on purpose: the client gets 202 immediately and polls;
        // the bus isolates handler failures, and the row carries the outcome.
        void eventBus.publish('INSTANCE_REBUILD', { instanceId: instance.id });
        res.status(202).json({ instance: toInstanceView(updated ?? instance), accepted: true });
        return;
      }
      default: {
        // actionSchema already rejected anything else; this keeps the switch total.
        const unreachable: never = action;
        throw new AppError(400, 'BAD_REQUEST', `unsupported action ${String(unreachable)}`);
      }
    }
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const instance = await loadOwned(req.params.id, user.id);
    const docker = getDocker();

    if (instance.containerId) {
      try {
        await docker.stop(instance.containerId);
      } catch {
        // Already gone is fine; the removal below is force-flagged anyway.
      }
      await docker.remove(instance.containerId);
    }
    getPortAllocator().release(instance.wsPort);
    getPortAllocator().release(instance.vncPort);
    await getProxyRouter().unregister(instance.id);
    await getStore().deleteInstance(instance.id);

    res.status(204).end();
  }),
);

/**
 * Returns the stream ticket and the RFB credential.
 * wsPath ends in /websockify because nginx rewrites
 * /vnc-stream/<id>(/.*)? to /websockify upstream.
 */
router.get(
  '/:id/connect',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const instance = await loadOwned(req.params.id, user.id);
    if (instance.status !== 'running') {
      throw new AppError(409, 'INVALID_STATE', `instance is ${instance.status}, not running`);
    }

    const signed = signVncToken(instance.id, user.id);
    // Opening a stream is user activity: it must reset the idle timer even when
    // the container's CPU stays flat.
    await getMetricsAgent().noteActivity(instance.id);

    res.json({
      wsPath: `${instance.proxyPath}/websockify`,
      token: signed.token,
      expiresAt: signed.expiresAt,
      // Delivered exactly once, to the owner, over TLS. Never in list/detail/
      // admin responses.
      rfbPassword: instance.vncPassword,
    });
  }),
);

router.get(
  '/:id/metrics',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const instance = await loadOwned(req.params.id, user.id);
    const limitParam = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 30;
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 150) : 30;
    const samples = getMetricsAgent().recentSamples(instance.id, limit);
    res.json({ instanceId: instance.id, samples });
  }),
);

export default router;
