/**
 * Proxy routing table (docs/agents.md §2.1 step 4).
 *
 * nginx cannot add upstreams at runtime, so the router renders a `map` from
 * instance id -> local websockify port, atomically replaces the include file
 * and reloads nginx. A failed reload leaves the previous map in place.
 */
import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';
import { logger } from '../logger';

const run = promisify(exec);

export interface ProxyRouter {
  register(instanceId: string, wsPort: number): Promise<void>;
  unregister(instanceId: string): Promise<void>;
  sync(entries: Array<{ instanceId: string; wsPort: number }>): Promise<void>;
  buildPath(instanceId: string): string;
}

export class NginxProxyRouter implements ProxyRouter {
  private readonly routes = new Map<string, number>();
  private reloadTimer: NodeJS.Timeout | null = null;
  private reloading = false;

  constructor(
    private readonly mapFile: string,
    private readonly reloadCmd: string,
  ) {}

  buildPath(instanceId: string): string {
    return `${config.proxy.pathPrefix}/${instanceId}`;
  }

  async register(instanceId: string, wsPort: number): Promise<void> {
    this.routes.set(instanceId, wsPort);
    await this.flush();
  }

  async unregister(instanceId: string): Promise<void> {
    if (this.routes.delete(instanceId)) await this.flush();
  }

  async sync(entries: Array<{ instanceId: string; wsPort: number }>): Promise<void> {
    this.routes.clear();
    for (const e of entries) this.routes.set(e.instanceId, e.wsPort);
    await this.flush();
  }

  private async flush(): Promise<void> {
    const lines = [
      '# Managed by CloudJava VNC ProvisionerAgent — do not edit by hand.',
      '# Regenerated on every instance lifecycle event.',
      'map $cloudjava_instance_id $cloudjava_upstream_port {',
      '    default 0;',
      ...[...this.routes.entries()].map(([id, port]) => `    "${id}" ${port};`),
      '}',
      '',
    ];
    const tmp = `${this.mapFile}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.mapFile), { recursive: true });
      await fs.writeFile(tmp, lines.join('\n'), { mode: 0o644 });
      await fs.rename(tmp, this.mapFile);
    } catch (err) {
      logger.error({ err, mapFile: this.mapFile }, 'failed to write proxy map');
      return;
    }
    this.scheduleReload();
  }

  /** Debounce: a burst of provisioning must not reload nginx per instance. */
  private scheduleReload(): void {
    if (this.reloadTimer) return;
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.reload();
    }, 250);
  }

  private async reload(): Promise<void> {
    if (this.reloading) return;
    this.reloading = true;
    try {
      await run(this.reloadCmd, { timeout: 10_000 });
      logger.info({ routes: this.routes.size }, 'nginx reloaded with new upstream map');
    } catch (err) {
      logger.error({ err, cmd: this.reloadCmd }, 'nginx reload failed — map kept on disk');
    } finally {
      this.reloading = false;
    }
  }
}

export class NoopProxyRouter implements ProxyRouter {
  private readonly routes = new Map<string, number>();

  buildPath(instanceId: string): string {
    return `${config.proxy.pathPrefix}/${instanceId}`;
  }

  async register(instanceId: string, wsPort: number): Promise<void> {
    this.routes.set(instanceId, wsPort);
    logger.info({ instanceId, wsPort, path: this.buildPath(instanceId) }, 'proxy route registered (noop)');
  }

  async unregister(instanceId: string): Promise<void> {
    this.routes.delete(instanceId);
    logger.info({ instanceId }, 'proxy route removed (noop)');
  }

  async sync(entries: Array<{ instanceId: string; wsPort: number }>): Promise<void> {
    this.routes.clear();
    for (const e of entries) this.routes.set(e.instanceId, e.wsPort);
    logger.info({ routes: this.routes.size }, 'proxy routes synced (noop)');
  }
}

let router: ProxyRouter | null = null;

export function getProxyRouter(): ProxyRouter {
  if (!router) {
    router = config.proxy.mode === 'nginx'
      ? new NginxProxyRouter(config.proxy.mapFile, config.proxy.reloadCmd)
      : new NoopProxyRouter();
  }
  return router;
}
