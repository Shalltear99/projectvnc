/**
 * Wire representation of an instance.
 *
 * WHY a DTO instead of returning the store row: the row contains `vncPassword`,
 * which must never appear in list/detail/admin responses (docs/security.md).
 * The single exception is GET /api/instances/:id/connect, which returns it once,
 * to the authenticated owner, over TLS, because websockify is a transparent
 * tunnel and cannot inject RFB credentials itself.
 */
import type { Instance } from '../types';

export interface InstanceView {
  id: string;
  userId: string;
  planId: string;
  status: Instance['status'];
  javaVersion: number;
  containerId: string | null;
  wsPort: number | null;
  vncPort: number | null;
  proxyPath: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  failureReason: string | null;
}

export function toInstanceView(instance: Instance): InstanceView {
  // Explicit field list, not `{...instance, vncPassword: undefined}`: a future
  // secret column would be copied by a spread but not by this mapping.
  return {
    id: instance.id,
    userId: instance.userId,
    planId: instance.planId,
    status: instance.status,
    javaVersion: instance.javaVersion,
    containerId: instance.containerId,
    wsPort: instance.wsPort,
    vncPort: instance.vncPort,
    proxyPath: instance.proxyPath,
    lastActivityAt: instance.lastActivityAt,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    expiresAt: instance.expiresAt,
    failureReason: instance.failureReason,
  };
}
