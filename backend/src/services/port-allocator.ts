/**
 * Dynamic port allocator (docs/agents.md §2.1).
 *
 * Two ranges are managed: RFB (5900-6000, loopback only) and websockify
 * (6000-7000, proxied). A port is only handed out when it is (a) not reserved
 * in-process, (b) not held by a live instance in the store, and (c) actually
 * bindable on this host — the third check is what catches a port stolen by an
 * unrelated process between deploys.
 */
import net from 'node:net';
import { logger } from '../logger';
import type { InstanceStatus } from '../types';
import type { Store } from '../db/store';

export type PortKind = 'vnc' | 'ws';

const LIVE_STATUSES: InstanceStatus[] = ['provisioning', 'running', 'stopped'];

export class PortAllocator {
  private readonly reserved = new Set<number>();
  private synced = false;

  constructor(
    private readonly ranges: Record<PortKind, { start: number; end: number }>,
    private readonly store: Store,
  ) {}

  /** Rebuild in-process reservations from durable state (call once at boot). */
  async sync(): Promise<void> {
    const instances = await this.store.listInstances({ status: LIVE_STATUSES });
    this.reserved.clear();
    for (const inst of instances) {
      if (inst.vncPort) this.reserved.add(inst.vncPort);
      if (inst.wsPort) this.reserved.add(inst.wsPort);
    }
    this.synced = true;
    logger.info({ reserved: this.reserved.size }, 'port allocator synced from store');
  }

  async reserve(kind: PortKind): Promise<number> {
    if (!this.synced) await this.sync();
    const { start, end } = this.ranges[kind];
    const candidates = [...Array(end - start).keys()].map((i) => start + i);
    for (const port of candidates) {
      if (this.reserved.has(port)) continue;
      if (!(await isPortBindable(port))) {
        logger.debug({ port }, 'port already bound by host process; skipping');
        continue;
      }
      this.reserved.add(port);
      logger.info({ kind, port }, 'port reserved');
      return port;
    }
    throw Object.assign(new Error(`no free ${kind} port in ${start}-${end}`), {
      code: 'PORT_EXHAUSTED',
      status: 503,
    });
  }

  release(port: number | null | undefined): void {
    if (port === null || port === undefined) return;
    if (this.reserved.delete(port)) logger.info({ port }, 'port released');
  }
}

export function isPortBindable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    const finish = (free: boolean) => {
      srv.removeAllListeners();
      srv.close(() => resolve(free));
    };
    srv.once('error', () => finish(false));
    srv.once('listening', () => finish(true));
    srv.listen({ port, host, exclusive: true });
  });
}
