export type UserRole = 'user' | 'admin';

export type InstanceStatus =
  | 'provisioning'
  | 'running'
  | 'stopped'
  | 'expired'
  | 'failed';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  suspendedAt: string | null;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  priceIdr: number;
  durationMinutes: number;
  javaVersion: 8 | 11 | 17 | 21;
  cpuCores: number;
  memoryMb: number;
  maxConcurrent: number;
}

export interface Instance {
  id: string;
  userId: string;
  planId: string;
  containerId: string | null;
  wsPort: number | null;
  vncPort: number | null;
  status: InstanceStatus;
  javaVersion: number;
  vncPassword: string;
  proxyPath: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  failureReason: string | null;
}

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'expired';

export interface Order {
  id: string;
  userId: string;
  planId: string;
  provider: string;
  providerRef: string;
  status: OrderStatus;
  amountIdr: number;
  createdAt: string;
  paidAt: string | null;
}

export interface MetricSample {
  instanceId: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  at: string;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  pids: number;
}

export interface ContainerSpec {
  instanceId: string;
  userId: string;
  image: string;
  vncPassword: string;
  javaVersion: number;
  wsPort: number;
  expiresAtEpochMs: number;
  limits: {
    cpus: number;
    memoryMb: number;
    pids: number;
    diskMb: number;
  };
}

export interface ManagedContainer {
  id: string;
  instanceId: string;
  state: 'created' | 'running' | 'exited' | 'dead';
  expiresAtEpochMs: number | null;
}
