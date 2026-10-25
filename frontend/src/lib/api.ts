import type {
  ApiErrorBody,
  AuthSession,
  CheckoutSession,
  ConnectInfo,
  CreateInstanceInput,
  Instance,
  InstanceMetrics,
  User,
} from './types';
import { normalizeMetrics } from './metrics';

/**
 * Base URL of the control-plane API.
 *
 * Two modes:
 *
 *  - `same-origin` (or `/`): emit RELATIVE urls (`/api/...`). Use this whenever
 *    the app is served through the nginx front door, which proxies `/api/` and
 *    the VNC websocket on the same origin as the dashboard. This is the mode to
 *    prefer in any real deployment: nothing host-specific is baked into the
 *    bundle, so the identical build works on a tailnet name, a raw tailnet IP,
 *    localhost, or a tunnel hostname. It also makes requests same-origin, so no
 *    CORS preflight or cookie cross-site rules are involved at all.
 *
 *  - an absolute origin (e.g. `https://vnc.example.com`): for split hosting,
 *    where the dashboard and the API are genuinely different origins. The value
 *    is inlined at BUILD time, so changing it requires a rebuild.
 *
 * An empty or whitespace-only value is treated as unset rather than as
 * "relative": `NEXT_PUBLIC_API_BASE=` in a CI file used to produce relative
 * urls against a server that has no /api routes, and every action failed with a
 * bare 404. Blank now falls back to the documented dev default.
 */
const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE?.trim();
const SAME_ORIGIN = RAW_API_BASE === 'same-origin' || RAW_API_BASE === '/';

export const API_BASE = SAME_ORIGIN
  ? ''
  : (RAW_API_BASE ? RAW_API_BASE : 'http://localhost:4000').replace(/\/+$/, '');

/** Error thrown for any non-2xx response, network failure or malformed body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** True when the session cookie is missing or expired. */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.code === 'unauthorized';
  }

  /** True when the API could not be reached at all (backend down / DNS / CORS). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  signal?: AbortSignal;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value;
}

/**
 * Single fetch wrapper: JSON in, JSON out, session cookie attached
 * (`credentials: 'include'` — the backend sets an httpOnly `cj_session` cookie
 * on login, so the browser never has to hold a token in JS).
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(
      `Cannot reach the CloudJava API at ${API_BASE}. Is the backend running?`,
      0,
      'network_error',
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const code =
      isApiErrorBody(parsed) && typeof parsed.error?.code === 'string'
        ? parsed.error.code
        : `http_${response.status}`;
    const message =
      isApiErrorBody(parsed) && typeof parsed.error?.message === 'string'
        ? parsed.error.message
        : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, code);
  }

  return parsed as T;
}

/* ------------------------------------------------------------------ auth --- */

export function register(email: string, password: string): Promise<AuthSession> {
  return request<AuthSession>('/api/auth/register', { method: 'POST', body: { email, password } });
}

export function login(email: string, password: string): Promise<AuthSession> {
  return request<AuthSession>('/api/auth/login', { method: 'POST', body: { email, password } });
}

export function logout(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST' });
}

export async function me(signal?: AbortSignal): Promise<User | null> {
  try {
    const body = await request<AuthSession | User>('/api/auth/me', { signal });
    // Accept either `{ user }` or a bare user object from the control plane.
    if (body !== null && typeof body === 'object' && 'user' in body) {
      return (body as AuthSession).user;
    }
    return body as User;
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) {
      return null;
    }
    throw error;
  }
}

/* ------------------------------------------------------------- instances --- */

export async function listInstances(signal?: AbortSignal): Promise<Instance[]> {
  // The API wraps collections in an envelope ({"instances": [...]}) so it can
  // add pagination metadata without breaking clients. Unwrap here, once, and
  // tolerate a bare array so an older/looser API shape cannot crash the page
  // with "x.filter is not a function".
  const raw = await request<Instance[] | { instances?: Instance[] }>('/api/instances', { signal });
  if (Array.isArray(raw)) return raw;
  return Array.isArray(raw?.instances) ? raw.instances : [];
}

/** Returns a pending checkout session; provisioning happens on the webhook. */
export function createInstance(input: CreateInstanceInput): Promise<CheckoutSession> {
  return request<CheckoutSession>('/api/instances', { method: 'POST', body: input });
}

/**
 * Settle an order without a real gateway. Only available when the API runs the
 * `mock` provider (development); in production this endpoint 404s and the user
 * is sent to the real checkout page instead.
 */
export function settleMockOrder(orderId: string): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/api/payments/${encodeURIComponent(orderId)}/mock-pay`,
    { method: 'POST', body: {} },
  );
}

export type InstanceAction = 'start' | 'stop' | 'restart' | 'reset';

export function instanceAction(id: string, action: InstanceAction): Promise<Instance> {
  return request<Instance>(`/api/instances/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
}

export function deleteInstance(id: string): Promise<void> {
  return request<void>(`/api/instances/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Short-lived stream ticket + websocket path + RFB password.
 * The token authorises the stream at the nginx proxy; `rfbPassword` authenticates
 * the RFB handshake. They are different credentials — see ConnectInfo.
 */
export function connect(id: string): Promise<ConnectInfo> {
  return request<ConnectInfo>(`/api/instances/${encodeURIComponent(id)}/connect`);
}

export async function metrics(id: string, signal?: AbortSignal): Promise<InstanceMetrics> {
  const raw = await request<unknown>(`/api/instances/${encodeURIComponent(id)}/metrics`, { signal });
  return normalizeMetrics(raw);
}

/** Metrics for several instances in parallel; individual failures resolve to null. */
export async function metricsMany(
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, InstanceMetrics | null>> {
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        return [id, await metrics(id, signal)] as const;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }
        return [id, null] as const;
      }
    }),
  );
  return Object.fromEntries(results);
}
