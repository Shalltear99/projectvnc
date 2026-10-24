/**
 * Docker Engine bindings (docs/tasks.md Task 2.1).
 *
 * Every container is created with the isolation mandated by docs/security.md:
 *   --cap-drop=ALL, --security-opt no-new-privileges, --user 1000:1000,
 *   cgroup cpu/mem/pids caps, RFB bound to 127.0.0.1, managed labels.
 *
 * `mock` is an in-process simulation used for dev and CI. It is structurally
 * identical to the real driver so the provisioning flow can be exercised
 * end-to-end without a Docker daemon; config.ts refuses to boot with it in
 * production.
 */
import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import { config } from '../config';
import { logger } from '../logger';
import type { ContainerSpec, ContainerStats, ManagedContainer } from '../types';

export interface DockerDriver {
  readonly kind: 'docker' | 'mock';
  createAndStart(spec: ContainerSpec): Promise<ManagedContainer>;
  start(containerId: string): Promise<void>;
  stop(containerId: string): Promise<void>;
  restart(containerId: string): Promise<void>;
  remove(containerId: string): Promise<void>;
  inspect(containerId: string): Promise<ManagedContainer | null>;
  listManaged(): Promise<ManagedContainer[]>;
  stats(containerId: string): Promise<ContainerStats | null>;
  freezeNetwork(containerId: string): Promise<void>;
}

const LABEL_MANAGED = 'cloudjava.managed';
const LABEL_INSTANCE = 'cloudjava.instance_id';
const LABEL_USER = 'cloudjava.user_id';
const LABEL_EXPIRES = 'cloudjava.expires_at';

function labelsToContainer(id: string, labels: Record<string, string>, state: string): ManagedContainer {
  const expires = labels[LABEL_EXPIRES];
  return {
    id,
    instanceId: labels[LABEL_INSTANCE] ?? '',
    state: (state as ManagedContainer['state']) ?? 'created',
    expiresAtEpochMs: expires ? Number(expires) : null,
  };
}

export class RealDockerDriver implements DockerDriver {
  readonly kind = 'docker' as const;
  private readonly docker: Docker;

  constructor(socketPath: string) {
    this.docker = new Docker({ socketPath });
  }

  async createAndStart(spec: ContainerSpec): Promise<ManagedContainer> {
    const name = `cloudjava-${spec.instanceId}`;
    const created = await this.docker.createContainer({
      name,
      Image: spec.image,
      // Non-root, no capabilities, no privilege escalation (docs/security.md)
      User: '1000:1000',
      Env: [
        `VNC_PASSWORD=${spec.vncPassword}`,
        `JAVA_ENV_VERSION=${spec.javaVersion}`,
        'SCREEN_W=1280',
        'SCREEN_H=720',
      ],
      Labels: {
        [LABEL_MANAGED]: 'true',
        [LABEL_INSTANCE]: spec.instanceId,
        [LABEL_USER]: spec.userId,
        [LABEL_EXPIRES]: String(spec.expiresAtEpochMs),
      },
      ExposedPorts: { '6080/tcp': {} },
      HostConfig: {
        // RFB/websockify are only reachable through the loopback + nginx proxy
        PortBindings: { '6080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(spec.wsPort) }] },
        Binds: [`cloudjava-${spec.instanceId}:/opt/game`],
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        Memory: spec.limits.memoryMb * 1024 * 1024,
        MemorySwap: spec.limits.memoryMb * 1024 * 1024, // no swap: OOM instead of host swap thrash
        NanoCpus: Math.round(spec.limits.cpus * 1e9),
        PidsLimit: spec.limits.pids,
        BlkioWeight: 300,
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
        RestartPolicy: { Name: 'no' },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '5m', 'max-file': '2' } },
      },
    });
    await created.start();
    logger.info({ containerId: created.id, instanceId: spec.instanceId }, 'container started');
    return { id: created.id, instanceId: spec.instanceId, state: 'running', expiresAtEpochMs: spec.expiresAtEpochMs };
  }

  private container(id: string) {
    return this.docker.getContainer(id);
  }

  async start(id: string): Promise<void> {
    await this.container(id).start();
  }

  async stop(id: string): Promise<void> {
    try {
      await this.container(id).stop({ t: 10 });
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 304) return; // already stopped
      throw err;
    }
  }

  async restart(id: string): Promise<void> {
    await this.container(id).restart({ t: 10 });
  }

  async remove(id: string): Promise<void> {
    try {
      await this.container(id).remove({ force: true, v: false });
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return;
      throw err;
    }
  }

  async inspect(id: string): Promise<ManagedContainer | null> {
    try {
      const info = await this.container(id).inspect();
      return labelsToContainer(id, info.Config.Labels ?? {}, info.State.Status);
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }

  async listManaged(): Promise<ManagedContainer[]> {
    const rows = await this.docker.listContainers({
      all: true,
      filters: { label: [`${LABEL_MANAGED}=true`] },
    });
    return rows.map((r) => labelsToContainer(r.Id, r.Labels ?? {}, r.State));
  }

  async stats(id: string): Promise<ContainerStats | null> {
    try {
      const raw = (await this.container(id).stats({ stream: false })) as {
        cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number };
        precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
        memory_stats?: { usage?: number; limit?: number };
        pids_stats?: { current?: number };
      };
      const cpuDelta =
        (raw.cpu_stats?.cpu_usage?.total_usage ?? 0) -
        (raw.precpu_stats?.cpu_usage?.total_usage ?? 0);
      const sysDelta =
        (raw.cpu_stats?.system_cpu_usage ?? 0) - (raw.precpu_stats?.system_cpu_usage ?? 0);
      const cpus = raw.cpu_stats?.online_cpus ?? 1;
      const cpuPercent = sysDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;
      return {
        cpuPercent: Math.round(cpuPercent * 100) / 100,
        memoryBytes: raw.memory_stats?.usage ?? 0,
        memoryLimitBytes: raw.memory_stats?.limit ?? 0,
        pids: raw.pids_stats?.current ?? 0,
      };
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }

  /** Cut egress without destroying the instance (abuse mitigation). */
  async freezeNetwork(id: string): Promise<void> {
    const info = await this.container(id).inspect();
    const pid = info.State.Pid;
    if (!pid || pid <= 0) throw new Error(`container ${id} is not running`);
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      // Drop the veth traffic at the host level; the container keeps its state.
      execFile('nsenter', ['-t', String(pid), '-n', 'iptables', '-P', 'OUTPUT', 'DROP'], (err) =>
        err ? reject(err) : resolve(),
      );
    });
    logger.warn({ containerId: id }, 'container egress frozen');
  }
}

interface MockContainer {
  id: string;
  spec: ContainerSpec;
  state: 'created' | 'running' | 'exited' | 'dead';
  frozen: boolean;
  startedAt: number;
}

export class MockDockerDriver implements DockerDriver {
  readonly kind = 'mock' as const;
  private readonly containers = new Map<string, MockContainer>();

  async createAndStart(spec: ContainerSpec): Promise<ManagedContainer> {
    if (process.env.MOCK_FAIL_PROVISIONING === 'true') {
      throw new Error('mock: image pull failed (MOCK_FAIL_PROVISIONING=true)');
    }
    // Simulated image-pull + boot latency, well inside PROVISION_TIMEOUT_MS.
    await new Promise((r) => setTimeout(r, 40));
    const id = `mock-${randomUUID()}`;
    this.containers.set(id, { id, spec, state: 'running', frozen: false, startedAt: Date.now() });
    logger.info({ containerId: id, instanceId: spec.instanceId }, 'mock container started');
    return { id, instanceId: spec.instanceId, state: 'running', expiresAtEpochMs: spec.expiresAtEpochMs };
  }

  private must(id: string): MockContainer {
    const c = this.containers.get(id);
    if (!c) throw Object.assign(new Error(`no such container: ${id}`), { statusCode: 404 });
    return c;
  }

  async start(id: string): Promise<void> {
    this.must(id).state = 'running';
  }

  async stop(id: string): Promise<void> {
    this.must(id).state = 'exited';
  }

  async restart(id: string): Promise<void> {
    const c = this.must(id);
    c.state = 'running';
    c.startedAt = Date.now();
  }

  async remove(id: string): Promise<void> {
    this.containers.delete(id);
  }

  async inspect(id: string): Promise<ManagedContainer | null> {
    const c = this.containers.get(id);
    if (!c) return null;
    return {
      id: c.id,
      instanceId: c.spec.instanceId,
      state: c.state,
      expiresAtEpochMs: c.spec.expiresAtEpochMs,
    };
  }

  async listManaged(): Promise<ManagedContainer[]> {
    return [...this.containers.values()].map((c) => ({
      id: c.id,
      instanceId: c.spec.instanceId,
      state: c.state,
      expiresAtEpochMs: c.spec.expiresAtEpochMs,
    }));
  }

  async stats(id: string): Promise<ContainerStats | null> {
    const c = this.containers.get(id);
    if (!c) return null;
    if (c.state !== 'running') {
      return { cpuPercent: 0, memoryBytes: 0, memoryLimitBytes: c.spec.limits.memoryMb * 1024 * 1024, pids: 0 };
    }
    const uptime = (Date.now() - c.startedAt) / 1000;
    const base = Number(process.env.MOCK_CPU_PERCENT ?? '12');
    const jitter = Math.sin(uptime) * 3;
    return {
      cpuPercent: Math.max(0, Math.round((base + jitter) * 100) / 100),
      memoryBytes: Math.round(c.spec.limits.memoryMb * 1024 * 1024 * 0.42),
      memoryLimitBytes: c.spec.limits.memoryMb * 1024 * 1024,
      pids: 14,
    };
  }

  async freezeNetwork(id: string): Promise<void> {
    this.must(id).frozen = true;
    logger.warn({ containerId: id }, 'mock container egress frozen');
  }
}

let driver: DockerDriver | null = null;

export function getDocker(): DockerDriver {
  if (!driver) {
    driver = config.docker.driver === 'docker'
      ? new RealDockerDriver(config.docker.socketPath)
      : new MockDockerDriver();
    logger.info({ driver: driver.kind }, 'docker driver ready');
  }
  return driver;
}

export const containerLabels = { LABEL_MANAGED, LABEL_INSTANCE, LABEL_USER, LABEL_EXPIRES };
