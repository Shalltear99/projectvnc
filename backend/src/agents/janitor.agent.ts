/**
 * JanitorAgent (docs/agents.md §2.3) — the only component allowed to destroy
 * things nobody asked it to destroy, so every action it takes is conservative:
 *
 *   * Session reaping: a row past expiresAt is expired regardless of what the
 *     container thinks; the container is stopped, removed and its ports freed.
 *   * Orphan cleanup: containers carrying our labels but with no instance row
 *     (crashed API mid-provision, manual docker run) are removed. Containers
 *     whose row is still in flight are left alone — the provisioner owns them.
 *   * Proxy sync: the nginx map is rewritten from the live set, so a crash
 *     between "container removed" and "route unregistered" cannot leave a
 *     stream path pointing at a dead port.
 *   * Abuse mitigation: a cpu_abuse SECURITY_ALERT freezes egress and fails the
 *     instance (docs/agents.md §4).
 *
 * runOnce() is public and side-effect-reporting so the whole sweep is testable
 * from an HTTP admin endpoint (POST /api/admin/janitor/run).
 */
import { config } from '../config';
import { getStore } from '../db/store';
import { eventBus } from '../events/bus';
import { agentLogger } from '../logger';
import { getDocker } from '../services/docker.service';
import { getPortAllocator } from '../services/ports';
import { getProxyRouter } from '../services/proxy-router';

const log = agentLogger('janitor');

const REAPABLE_STATUSES = ['provisioning', 'running', 'stopped'] as const;

export interface JanitorSummary {
  at: string;
  reaped: number;
  orphans: number;
  frozen: number;
}

export class JanitorAgent {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private sweeping = false;
  /** instanceIds awaiting a freeze; retried on the next sweep if the first try fails. */
  private readonly abuseQueue: string[] = [];
  private frozenSinceLastRun = 0;
  private lastRun: JanitorSummary | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await eventBus.subscribe('SECURITY_ALERT', (payload) => this.onSecurityAlert(payload));
    this.timer = setInterval(() => {
      void this.runOnce().catch((err) => log.error({ err }, 'janitor sweep failed'));
    }, config.agents.janitorIntervalMs);
    log.info({ intervalMs: config.agents.janitorIntervalMs }, 'janitor loop started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('janitor loop stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  status(): { running: boolean; lastRun: JanitorSummary | null; pendingAbuse: number } {
    return { running: this.running, lastRun: this.lastRun, pendingAbuse: this.abuseQueue.length };
  }

  private async onSecurityAlert(payload: { instanceId: string; kind: string }): Promise<void> {
    if (payload.kind !== 'cpu_abuse' || !payload.instanceId) return;
    if (this.abuseQueue.includes(payload.instanceId)) return;
    this.abuseQueue.push(payload.instanceId);
    // Act now rather than waiting up to a full interval: abuse is the one case
    // where latency has a direct cost. The queue entry is the retry path.
    const frozen = await this.mitigate(payload.instanceId);
    if (frozen) {
      this.frozenSinceLastRun += 1;
      const idx = this.abuseQueue.indexOf(payload.instanceId);
      if (idx >= 0) this.abuseQueue.splice(idx, 1);
    }
  }

  /** Freeze egress and fail the instance. Returns true when mitigation stuck. */
  private async mitigate(instanceId: string): Promise<boolean> {
    const store = getStore();
    const docker = getDocker();
    try {
      const instance = await store.getInstance(instanceId);
      if (!instance) {
        log.warn({ instanceId }, 'abuse alert for unknown instance');
        return true; // nothing to do; drop it from the queue
      }
      if (instance.containerId) {
        await docker.freezeNetwork(instance.containerId);
      }
      await store.updateInstance(instanceId, {
        status: 'failed',
        failureReason: 'security: sustained CPU abuse — network egress frozen, pending review',
      });
      log.error({ instanceId, containerId: instance.containerId }, 'instance frozen for abuse');
      return true;
    } catch (err) {
      log.error({ err, instanceId }, 'abuse mitigation failed — will retry');
      return false;
    }
  }

  /**
   * One full sweep. Never throws: a failing sub-step is logged and the rest of
   * the sweep continues, because "the janitor crashed" means resources leak.
   */
  async runOnce(): Promise<JanitorSummary> {
    if (this.sweeping) {
      // Overlapping sweeps could reap the same instance twice and double-release
      // ports; report the previous summary instead.
      return this.lastRun ?? { at: new Date().toISOString(), reaped: 0, orphans: 0, frozen: 0 };
    }
    this.sweeping = true;
    const summary: JanitorSummary = { at: new Date().toISOString(), reaped: 0, orphans: 0, frozen: 0 };
    try {
      summary.reaped = await this.reapExpired();
      summary.orphans = await this.sweepOrphans();
      summary.frozen = await this.drainAbuseQueue();
      await this.syncProxy();
    } catch (err) {
      log.error({ err }, 'janitor sweep failed');
    } finally {
      this.sweeping = false;
    }
    this.lastRun = summary;
    if (summary.reaped || summary.orphans || summary.frozen) {
      log.info(summary, 'janitor sweep complete');
    }
    return summary;
  }

  private async reapExpired(): Promise<number> {
    const store = getStore();
    const docker = getDocker();
    const router = getProxyRouter();
    const allocator = getPortAllocator();
    let reaped = 0;

    const live = await store.listInstances({ status: [...REAPABLE_STATUSES] });
    const now = Date.now();

    for (const instance of live) {
      if (new Date(instance.expiresAt).getTime() > now) continue;
      try {
        if (instance.containerId) {
          try {
            await docker.stop(instance.containerId);
          } catch (err) {
            log.warn({ err, instanceId: instance.id }, 'stop of expired container failed (continuing)');
          }
          try {
            await docker.remove(instance.containerId);
          } catch (err) {
            log.warn({ err, instanceId: instance.id }, 'remove of expired container failed (continuing)');
          }
        }
        allocator.release(instance.wsPort);
        allocator.release(instance.vncPort);
        try {
          await router.unregister(instance.id);
        } catch (err) {
          log.warn({ err, instanceId: instance.id }, 'proxy unregister failed during reap');
        }
        await store.updateInstance(instance.id, {
          status: 'expired',
          containerId: null,
          wsPort: null,
          vncPort: null,
          failureReason: 'subscription expired',
        });
        await eventBus.publish('INSTANCE_EXPIRED', { instanceId: instance.id, userId: instance.userId });
        reaped += 1;
        log.info({ instanceId: instance.id, expiresAt: instance.expiresAt }, 'expired instance reaped');
      } catch (err) {
        // One unreapable instance must not block the others.
        log.error({ err, instanceId: instance.id }, 'failed to reap instance');
      }
    }
    return reaped;
  }

  private async sweepOrphans(): Promise<number> {
    const store = getStore();
    const docker = getDocker();
    let removed = 0;

    let managed;
    try {
      managed = await docker.listManaged();
    } catch (err) {
      log.error({ err }, 'docker listManaged failed; skipping orphan sweep');
      return 0;
    }

    for (const container of managed) {
      if (!container.instanceId) continue; // not ours despite the label
      try {
        const row = await store.getInstance(container.instanceId);
        // A container kept alive on purpose: an abuse-frozen instance stays in
        // place for admin review, so the sweep must not quietly delete it.
        const heldForReview = row?.status === 'failed' && (row.failureReason ?? '').startsWith('security:');
        const orphan = !row || row.status === 'expired' || (row.status === 'failed' && !heldForReview);
        if (!orphan) continue;
        await docker.remove(container.id);
        removed += 1;
        log.info({ containerId: container.id, instanceId: container.instanceId }, 'orphan container removed');
      } catch (err) {
        log.warn({ err, containerId: container.id }, 'orphan removal failed');
      }
    }
    return removed;
  }

  private async drainAbuseQueue(): Promise<number> {
    let frozen = this.frozenSinceLastRun;
    this.frozenSinceLastRun = 0;
    for (const instanceId of [...this.abuseQueue]) {
      const ok = await this.mitigate(instanceId);
      if (ok) {
        frozen += 1;
        const idx = this.abuseQueue.indexOf(instanceId);
        if (idx >= 0) this.abuseQueue.splice(idx, 1);
      }
    }
    return frozen;
  }

  /** Rewrite the proxy map from the authoritative live set. */
  private async syncProxy(): Promise<void> {
    const store = getStore();
    const live = await store.listInstances({ status: ['running'] });
    const entries = live
      .filter((i): i is typeof i & { wsPort: number } => typeof i.wsPort === 'number')
      .map((i) => ({ instanceId: i.id, wsPort: i.wsPort }));
    try {
      await getProxyRouter().sync(entries);
    } catch (err) {
      log.error({ err }, 'proxy sync failed');
    }
  }
}

let agent: JanitorAgent | null = null;

export function getJanitorAgent(): JanitorAgent {
  if (!agent) agent = new JanitorAgent();
  return agent;
}

export function start(): Promise<void> {
  return getJanitorAgent().start();
}

export function stop(): Promise<void> {
  return getJanitorAgent().stop();
}

export function runOnce(): Promise<JanitorSummary> {
  return getJanitorAgent().runOnce();
}
