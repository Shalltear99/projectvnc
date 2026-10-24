/**
 * Types mirroring the control-plane API contract (backend/).
 * The stored `vncPassword` column is never serialised to the browser; instead
 * GET /api/instances/:id/connect hands out a short-lived stream ticket plus the
 * per-session RFB password for that one viewer mount.
 */

export type InstanceStatus = 'provisioning' | 'running' | 'stopped' | 'expired' | 'failed';

export const INSTANCE_STATUSES: readonly InstanceStatus[] = [
  'provisioning',
  'running',
  'stopped',
  'expired',
  'failed',
];

/** Public instance shape (server → client). */
export interface Instance {
  id: string;
  planId: string;
  status: InstanceStatus;
  javaVersion: string;
  proxyPath: string;
  wsPort: number;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string | null;
  failureReason: string | null;
}

export interface User {
  id: string;
  email: string;
  createdAt?: string;
}

/** Response body of POST /api/auth/login and /api/auth/register. */
export interface AuthSession {
  user: User;
}

/**
 * Response body of GET /api/instances/:id/connect.
 *
 * TWO CREDENTIALS, DO NOT MERGE THEM:
 *  - `token` is a short-lived HMAC stream ticket. It travels in the websocket
 *    URL (`<wsPath>?token=...`) and is validated by the nginx edge proxy to
 *    authorise *the stream*. It says nothing to the VNC server.
 *  - `rfbPassword` is the actual RFB/VNC session password. It is passed to
 *    noVNC as the `password` query param and authenticates *the VNC handshake*.
 * Replacing one with the other fails: a ticket as the RFB password yields
 * "authentication failed", and the RFB password in the URL leaks the session
 * secret to the proxy logs without authorising anything.
 */
export interface ConnectInfo {
  /** Websocket path, e.g. `/vnc-stream/<instanceId>/websockify`. */
  wsPath: string;
  /** One-time HMAC ticket appended as `?token=` on the websocket path. */
  token: string;
  /** ISO timestamp after which the ticket is rejected. */
  expiresAt: string;
  /** RFB session password (never persisted, never put in the top-level URL). */
  rfbPassword: string;
}

/** Normalised metrics (server shape varies; see lib/metrics.ts). */
export interface InstanceMetrics {
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
  sampledAt: string | null;
}

export interface CreateInstanceInput {
  planId: string;
  javaVersion: string;
}

/**
 * What POST /api/instances actually returns: a pending ORDER, not an instance.
 *
 * Provisioning is driven by the payment webhook, never by the browser (a client
 * must not be able to conjure a container without paying). So the dashboard has
 * to send the user to the gateway — or, in mock mode, settle the order itself.
 */
export interface CheckoutSession {
  orderId: string;
  provider: string;
  providerRef: string;
  amountIdr: number;
  checkoutUrl: string;
  expiresAt: string;
}

/** Error envelope returned by the API: `{ error: { code, message } }`. */
export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export type PlanId = 'daily' | 'weekly' | 'monthly';

export interface Plan {
  id: PlanId;
  name: string;
  priceIdr: number;
  durationMinutes: number;
  blurb: string;
  highlights: string[];
  featured?: boolean;
}

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  variant: ToastVariant;
  text: string;
}
