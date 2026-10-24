import type { InstanceMetrics } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function pickNumber(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function pickString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') {
      return value;
    }
  }
  return null;
}

const ZERO: InstanceMetrics = {
  cpuPercent: 0,
  memoryUsedMb: 0,
  memoryLimitMb: 0,
  sampledAt: null,
};

/**
 * The metrics endpoint is owned by the backend agent and may return either
 * `{ cpuPercent, memoryUsedMb, memoryLimitMb }` or a Docker-stats-like payload
 * (`{ cpu, memory: { usage, limit } }`). Normalise defensively so a shape change
 * degrades the gauges instead of crashing the dashboard.
 */
export function normalizeMetrics(raw: unknown): InstanceMetrics {
  const root = asRecord(raw);
  if (!root) {
    return ZERO;
  }
  const data = asRecord(root.data) ?? asRecord(root.metrics) ?? root;

  // Keys ending in "Bytes" carry byte values and must be converted to MB; all
  // other keys are already MB-valued. pickKey returns the key that matched.
  const MB_KEYS = ['memoryUsedMb', 'memUsedMb', 'memoryUsed', 'memUsed', 'memory_used_mb'] as const;
  const BYTE_KEYS = ['memoryBytes', 'memBytes'] as const;
  const LIMIT_MB_KEYS = ['memoryLimitMb', 'memLimitMb', 'memoryLimit', 'memLimit', 'memory_limit_mb'] as const;
  const LIMIT_BYTE_KEYS = ['memoryLimitBytes', 'memLimitBytes'] as const;

  function pickKey(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): { key: string; value: number } | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) return { key, value };
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return { key, value: parsed };
      }
    }
    return null;
  }

  const toMb = (hit: { key: string; value: number } | null): number | null =>
    hit === null ? null : /Bytes$/.test(hit.key) ? hit.value / (1024 * 1024) : hit.value;

  let memoryUsedMb = toMb(pickKey(data, [...MB_KEYS, ...BYTE_KEYS]));
  let memoryLimitMb = toMb(pickKey(data, [...LIMIT_MB_KEYS, ...LIMIT_BYTE_KEYS]));

  const memory = asRecord(data.memory);
  if (memory) {
    const usage = pickNumber(memory, ['usage', 'used']);
    const limit = pickNumber(memory, ['limit', 'total']);
    if (memoryUsedMb === null && usage !== null) {
      memoryUsedMb = usage / (1024 * 1024);
    }
    if (memoryLimitMb === null && limit !== null) {
      memoryLimitMb = limit / (1024 * 1024);
    }
  }

  const cpuPercent = pickNumber(data, ['cpuPercent', 'cpu_percent', 'cpu', 'cpuUsagePercent']);

  return {
    cpuPercent: clamp(cpuPercent ?? 0, 0, 100),
    memoryUsedMb: Math.max(0, Math.round(memoryUsedMb ?? 0)),
    memoryLimitMb: Math.max(0, Math.round(memoryLimitMb ?? 0)),
    sampledAt: pickString(data, ['sampledAt', 'timestamp', 'at']),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
