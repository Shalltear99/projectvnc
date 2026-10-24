/**
 * MetricsAgent (docs/agents.md §2.2).
 *
 * A polling loop, not an event stream: cgroup stats have to be pulled. Two
 * things it must never do are (a) throw outward — one bad container would kill
 * telemetry for everyone — and (b) publish the same alert every tick, which
 * would turn the event bus into a firehose. Alerts are therefore edge-triggered:
 * raised once when a condition starts, re-armed when it clears.
 */
import { config } from '../config';
import { getStore } from '../db/store';
import { eventBus } from '../events/bus';
import { agentLogger } from '../logger';
import { getDocker } from '../services/docker.service';
import type { MetricSample } from '../types';

const log = agentLogger('metrics');

/** Samples kept per instance (~5 minutes at the 2s default interval). */
const RING_SIZE = 150;
/** Below this the instance is considered idle: nothing is running in the JVM. */
const ACTIVITY_CPU_PERCENT = 1;

interface AbuseState {
  since: number;
  alerted: boolean;
}

export class MetricsAgent {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticking = false;
  private readonly samples = new Map<string, MetricSample[]>();
  private readonly abuse = new Map<string, AbuseState>();
  private readonly idleAlerted = new Set<string>();
  private lastTickAt: string | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // First sample immediately so a freshly started API has data to serve
    // instead of an empty chart for one interval.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.agents.metricsIntervalMs);
    log.info({ intervalMs: config.agents.metricsIntervalMs }, 'metrics loop started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('metrics loop stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  status(): { running: boolean; lastTickAt: string | null; trackedInstances: number } {
    return { running: this.running, lastTickAt: this.lastTickAt, trackedInstances: this.samples.size };
  }

  /** Recent samples, oldest first. Served by GET /api/instances/:id/metrics. */
  recentSamples(instanceId: string, limit = 30): MetricSample[] {
    const ring = this.samples.get(instanceId) ?? [];
    return ring.slice(Math.max(0, ring.length - limit));
  }

  /**
   * Mark an instance as active right now (stream opened). Kept separate from the
   * sampling loop so a user connecting to an otherwise idle box resets its idle
   * timer even though CPU is flat.
   */
  async noteActivity(instanceId: string): Promise<void> {
    this.idleAlerted.delete(instanceId);
    try {
      await getStore().updateInstance(instanceId, { lastActivityAt: new Date().toISOString() });
    } catch (err) {
      log.warn({ err, instanceId }, 'failed to record activity');
    }
  }

  private async tick(): Promise<void> {
    if (!this.running || this.ticking) return; // no overlapping ticks
    this.ticking = true;
    this.lastTickAt = new Date().toISOString();
    try {
      const store = getStore();
      const docker = getDocker();
      const instances = await store.listInstances({ status: ['running'] });

      for (const instance of instances) {
        if (!instance.containerId) continue;
        try {
          const stats = await docker.stats(instance.containerId);
          if (!stats) continue; // container vanished; the janitor will reap the row

          const sample: MetricSample = {
            instanceId: instance.id,
            cpuPercent: stats.cpuPercent,
            memoryBytes: stats.memoryBytes,
            memoryLimitBytes: stats.memoryLimitBytes,
            at: new Date().toISOString(),
          };
          this.pushSample(instance.id, sample);

          const active = stats.cpuPercent >= ACTIVITY_CPU_PERCENT;
          if (active) {
            this.idleAlerted.delete(instance.id);
            await store.updateInstance(instance.id, { lastActivityAt: sample.at });
          }

          await this.checkAbuse(instance.id, stats.cpuPercent);
          await this.checkIdle(instance.id, instance.lastActivityAt);
        } catch (err) {
          // Per-instance isolation: a broken container must not stop the sweep.
          log.warn({ err, instanceId: instance.id }, 'sample failed');
        }
      }
    } catch (err) {
      log.error({ err }, 'metrics tick failed');
    } finally {
      this.ticking = false;
    }
  }

  private pushSample(instanceId: string, sample: MetricSample): void {
    const ring = this.samples.get(instanceId) ?? [];
    ring.push(sample);
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
    this.samples.set(instanceId, ring);
  }

  private async checkAbuse(instanceId: string, cpuPercent: number): Promise<void> {
    const threshold = config.agents.abuseCpuPercent;
    if (cpuPercent < threshold) {
      this.abuse.delete(instanceId); // re-arm: a new spike is a new episode
      return;
    }
    const now = Date.now();
    const state = this.abuse.get(instanceId) ?? { since: now, alerted: false };
    this.abuse.set(instanceId, state);
    if (state.alerted) return;
    if (now - state.since < config.agents.abuseSustainMs) return;

    state.alerted = true;
    log.warn({ instanceId, cpuPercent, sustainedMs: now - state.since }, 'sustained CPU abuse detected');
    await eventBus.publish('SECURITY_ALERT', {
      instanceId,
      kind: 'cpu_abuse',
      detail: `cpu ${cpuPercent.toFixed(1)}% >= ${threshold}% for ${Math.round((now - state.since) / 1000)}s`,
    });
  }

  private async checkIdle(instanceId: string, lastActivityAt: string): Promise<void> {
    const idleMs = Date.now() - new Date(lastActivityAt).getTime();
    if (idleMs < config.agents.inactiveStreamTimeoutMs) return;
    if (this.idleAlerted.has(instanceId)) return; // edge-triggered
    this.idleAlerted.add(instanceId);
    await eventBus.publish('INSTANCE_IDLE', { instanceId, idleMs });
    log.info({ instanceId, idleMs }, 'instance idle');
  }
}

let agent: MetricsAgent | null = null;

export function getMetricsAgent(): MetricsAgent {
  if (!agent) agent = new MetricsAgent();
  return agent;
}

export function start(): Promise<void> {
  return getMetricsAgent().start();
}

export function stop(): Promise<void> {
  return getMetricsAgent().stop();
}
