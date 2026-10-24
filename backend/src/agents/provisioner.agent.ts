/**
 * ProvisionerAgent (docs/agents.md §2.1).
 *
 * Consumes ORDER_PAID and INSTANCE_REBUILD and turns them into exactly one
 * running container per instance. Every step is paired with an undo, because a
 * half-provisioned instance that holds a port or a container is worse than no
 * instance at all: it blocks the allocator and leaks host resources.
 *
 *   reserve vnc + ws  ->  create row  ->  docker create/start  ->  mark running
 *          ^                                     |
 *          └──────────── rollback ◄──────────────┘   (timeout or any error)
 */
import { randomInt } from 'node:crypto';
import { config } from '../config';
import { getStore } from '../db/store';
import { eventBus, type EventPayloads } from '../events/bus';
import { agentLogger } from '../logger';
import { findPlan } from '../plans';
import { getDocker } from '../services/docker.service';
import { getProxyRouter } from '../services/proxy-router';
import { getPortAllocator } from '../services/ports';
import type { ContainerSpec, Instance, Plan } from '../types';

const log = agentLogger('provisioner');

/** Alphabet excludes look-alikes (0/O, 1/l/I) so users can retype the password. */
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PASSWORD_LENGTH = 20;

export function generateVncPassword(length = PASSWORD_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

class ProvisionTimeoutError extends Error {
  constructor(ms: number) {
    super(`container did not start within ${ms}ms`);
    this.name = 'ProvisionTimeoutError';
  }
}

export class ProvisionerAgent {
  private started = false;
  /** orderId -> instanceId, so a redelivered ORDER_PAID is a no-op. */
  private readonly provisionedOrders = new Map<string, string>();
  private readonly inFlightOrders = new Set<string>();
  private readonly inFlightRebuilds = new Set<string>();

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await eventBus.subscribe('ORDER_PAID', (payload) => this.onOrderPaid(payload));
    await eventBus.subscribe('INSTANCE_REBUILD', (payload) => this.onRebuild(payload));
    log.info('provisioner subscribed to ORDER_PAID, INSTANCE_REBUILD');
  }

  async stop(): Promise<void> {
    // The bus interface has no unsubscribe; handlers become inert instead.
    this.started = false;
    log.info('provisioner stopped');
  }

  isRunning(): boolean {
    return this.started;
  }

  private async onOrderPaid(payload: EventPayloads['ORDER_PAID']): Promise<void> {
    if (!this.started) return;
    const { orderId } = payload;

    const existingInstanceId = this.provisionedOrders.get(orderId);
    if (existingInstanceId) {
      log.info({ orderId, instanceId: existingInstanceId }, 'order already provisioned, skipping');
      return;
    }
    if (this.inFlightOrders.has(orderId)) {
      log.info({ orderId }, 'order already being provisioned, skipping duplicate delivery');
      return;
    }
    this.inFlightOrders.add(orderId);
    try {
      await this.provisionOrder(orderId, payload.userId, payload.planId);
    } catch (err) {
      // Never let a provisioning failure escape into the event bus: the bus
      // isolates handlers, but an unhandled rejection would still be logged as a
      // crash and hide the real cause.
      log.error({ err, orderId }, 'provisioning threw unexpectedly');
    } finally {
      this.inFlightOrders.delete(orderId);
    }
  }

  private async provisionOrder(orderId: string, payloadUserId: string, payloadPlanId: string): Promise<void> {
    const store = getStore();
    const order = await store.getOrder(orderId);
    if (!order) {
      log.error({ orderId }, 'ORDER_PAID for unknown order — ignoring');
      return;
    }
    // The event payload is advisory; the durable order row is authoritative.
    if (order.status !== 'paid') {
      log.warn({ orderId, status: order.status }, 'ORDER_PAID for unpaid order — ignoring');
      return;
    }

    const plan = findPlan(order.planId) ?? findPlan(payloadPlanId);
    if (!plan) {
      log.error({ orderId, planId: order.planId }, 'unknown plan on paid order');
      return;
    }

    const userId = order.userId || payloadUserId;

    // Idempotency across restarts: if this payment already produced a live
    // instance (row created after the order), adopt it instead of provisioning.
    const live = await store.listInstancesByUser(userId);
    const samePayment = live.find(
      (i) =>
        i.planId === plan.id &&
        (i.status === 'provisioning' || i.status === 'running') &&
        i.createdAt >= order.createdAt,
    );
    if (samePayment) {
      this.provisionedOrders.set(orderId, samePayment.id);
      log.info({ orderId, instanceId: samePayment.id }, 'live instance already exists for this payment');
      return;
    }

    const router = getProxyRouter();
    // The instance row must exist before the container so we have a stable id for
    // the proxy path and the container labels.
    const instance = await store.createInstance({
      userId,
      planId: plan.id,
      javaVersion: plan.javaVersion,
      vncPassword: generateVncPassword(),
      expiresAt: new Date(Date.now() + plan.durationMinutes * 60_000).toISOString(),
      proxyPath: '', // filled below, once the id exists
    });

    const proxyPath = router.buildPath(instance.id);
    const withPath = (await store.updateInstance(instance.id, { proxyPath })) ?? instance;
    this.provisionedOrders.set(orderId, instance.id);

    await this.launch(withPath, plan, { freshPassword: false });
  }

  private async onRebuild(payload: EventPayloads['INSTANCE_REBUILD']): Promise<void> {
    if (!this.started) return;
    const { instanceId } = payload;
    if (this.inFlightRebuilds.has(instanceId)) return;
    this.inFlightRebuilds.add(instanceId);
    try {
      const store = getStore();
      const instance = await store.getInstance(instanceId);
      if (!instance) {
        log.warn({ instanceId }, 'INSTANCE_REBUILD for unknown instance');
        return;
      }
      const plan = findPlan(instance.planId);
      if (!plan) {
        log.error({ instanceId, planId: instance.planId }, 'INSTANCE_REBUILD for unknown plan');
        return;
      }
      // Reset semantics: destroy the old container, free its ports, and start a
      // clean one with a NEW password — the old credential may have leaked.
      await this.destroyContainer(instance);
      const rebuilt = (await store.updateInstance(instance.id, {
        status: 'provisioning',
        containerId: null,
        wsPort: null,
        vncPort: null,
        vncPassword: generateVncPassword(),
        failureReason: null,
      })) ?? instance;
      await this.launch(rebuilt, plan, { freshPassword: true });
    } catch (err) {
      log.error({ err, instanceId }, 'rebuild failed');
    } finally {
      this.inFlightRebuilds.delete(instanceId);
    }
  }

  /**
   * Reserve ports, create the container (bounded by provisionTimeoutMs) and
   * publish the outcome. On any failure: undo everything, mark the row failed.
   */
  private async launch(instance: Instance, plan: Plan, opts: { freshPassword: boolean }): Promise<void> {
    const store = getStore();
    const docker = getDocker();
    const router = getProxyRouter();

    let vncPort: number | null = null;
    let wsPort: number | null = null;
    let containerId: string | null = null;

    try {
      vncPort = await getPortAllocator().reserve('vnc');
      wsPort = await getPortAllocator().reserve('ws');

      const spec: ContainerSpec = {
        instanceId: instance.id,
        userId: instance.userId,
        image: config.docker.workerImage,
        vncPassword: instance.vncPassword,
        javaVersion: plan.javaVersion,
        wsPort,
        expiresAtEpochMs: new Date(instance.expiresAt).getTime(),
        limits: {
          // Plan is the commercial promise, config is the host safety ceiling.
          cpus: Math.min(plan.cpuCores, config.instances.limits.cpus),
          memoryMb: Math.min(plan.memoryMb, config.instances.limits.memoryMb),
          pids: config.instances.limits.pids,
          diskMb: config.instances.limits.diskMb,
        },
      };

      const container = await this.withProvisionTimeout(docker.createAndStart(spec));
      containerId = container.id;

      const updated = await store.updateInstance(instance.id, {
        status: 'running',
        containerId,
        wsPort,
        vncPort,
        failureReason: null,
      });
      if (!updated) throw new Error('instance row disappeared during provisioning');

      // Route registration comes last: a proxied path must never point at a
      // container that is not yet accounted for in the store.
      await router.register(instance.id, wsPort);

      await eventBus.publish('INSTANCE_READY', {
        instanceId: instance.id,
        userId: instance.userId,
        proxyPath: instance.proxyPath,
      });
      log.info(
        { instanceId: instance.id, containerId, wsPort, vncPort, freshPassword: opts.freshPassword },
        'instance ready',
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ err, instanceId: instance.id }, 'provisioning failed — rolling back');

      if (containerId) {
        try {
          await docker.remove(containerId);
        } catch (removeErr) {
          log.error({ err: removeErr, containerId }, 'rollback: container removal failed');
        }
      }
      getPortAllocator().release(wsPort);
      getPortAllocator().release(vncPort);
      try {
        await router.unregister(instance.id);
      } catch (routeErr) {
        log.error({ err: routeErr, instanceId: instance.id }, 'rollback: proxy unregister failed');
      }

      await store.updateInstance(instance.id, {
        status: 'failed',
        failureReason: reason.slice(0, 500),
        containerId: null,
        wsPort: null,
        vncPort: null,
      });
      await eventBus.publish('PROVISIONING_FAILED', { instanceId: instance.id, reason });
    }
  }

  /**
   * Race the Docker call against provisionTimeoutMs (docs/agents.md §2.1: 5s).
   * If the timeout wins, the in-flight create is still awaited in the background
   * and the container it eventually produces is removed — otherwise a slow image
   * pull would leave an unlabelled container running with our ports bound.
   */
  private async withProvisionTimeout(work: Promise<{ id: string }>): Promise<{ id: string }> {
    const ms = config.docker.provisionTimeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProvisionTimeoutError(ms)), ms);
    });
    try {
      return await Promise.race([work, timeout]);
    } catch (err) {
      if (err instanceof ProvisionTimeoutError) {
        void work
          .then((late) => getDocker().remove(late.id))
          .catch((lateErr) => log.error({ err: lateErr }, 'late container cleanup failed'));
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Stop/remove a container and free its ports; safe when nothing exists. */
  private async destroyContainer(instance: Instance): Promise<void> {
    const docker = getDocker();
    if (instance.containerId) {
      try {
        await docker.stop(instance.containerId);
      } catch (err) {
        log.warn({ err, containerId: instance.containerId }, 'stop before destroy failed (continuing)');
      }
      try {
        await docker.remove(instance.containerId);
      } catch (err) {
        log.warn({ err, containerId: instance.containerId }, 'remove before destroy failed (continuing)');
      }
    }
    getPortAllocator().release(instance.wsPort);
    getPortAllocator().release(instance.vncPort);
    try {
      await getProxyRouter().unregister(instance.id);
    } catch (err) {
      log.warn({ err, instanceId: instance.id }, 'proxy unregister during destroy failed');
    }
  }
}

let provisioner: ProvisionerAgent | null = null;

export function getProvisionerAgent(): ProvisionerAgent {
  if (!provisioner) provisioner = new ProvisionerAgent();
  return provisioner;
}
