/**
 * PostgreSQL driver. Column names are snake_case; all mapping happens here so
 * the rest of the codebase sees camelCase domain objects only.
 */
import { Pool } from 'pg';
import { logger } from '../logger';
import type { Instance, InstanceStatus, Order, User, UserRole } from '../types';
import type { NewInstance, NewOrder, NewUser, Store } from './store';

type Row = Record<string, unknown>;

const toIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? '');

const toIsoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : toIso(v);

function mapUser(r: Row): User {
  return {
    id: String(r.id),
    email: String(r.email),
    passwordHash: String(r.password_hash),
    role: String(r.role) as UserRole,
    createdAt: toIso(r.created_at),
    suspendedAt: toIsoOrNull(r.suspended_at),
  };
}

function mapInstance(r: Row): Instance {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    planId: String(r.plan_id),
    containerId: r.container_id ? String(r.container_id) : null,
    wsPort: r.ws_port === null || r.ws_port === undefined ? null : Number(r.ws_port),
    vncPort: r.vnc_port === null || r.vnc_port === undefined ? null : Number(r.vnc_port),
    status: String(r.status) as InstanceStatus,
    javaVersion: Number(r.java_version),
    vncPassword: String(r.vnc_password),
    proxyPath: String(r.proxy_path),
    lastActivityAt: toIso(r.last_activity_at),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    expiresAt: toIso(r.expires_at),
    failureReason: r.failure_reason ? String(r.failure_reason) : null,
  };
}

function mapOrder(r: Row): Order {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    planId: String(r.plan_id),
    provider: String(r.provider),
    providerRef: String(r.provider_ref),
    status: String(r.status) as Order['status'],
    amountIdr: Number(r.amount_idr),
    createdAt: toIso(r.created_at),
    paidAt: toIsoOrNull(r.paid_at),
  };
}

const INSTANCE_COLUMNS: Record<keyof Instance, string> = {
  id: 'id',
  userId: 'user_id',
  planId: 'plan_id',
  containerId: 'container_id',
  wsPort: 'ws_port',
  vncPort: 'vnc_port',
  status: 'status',
  javaVersion: 'java_version',
  vncPassword: 'vnc_password',
  proxyPath: 'proxy_path',
  lastActivityAt: 'last_activity_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  expiresAt: 'expires_at',
  failureReason: 'failure_reason',
};

const ORDER_COLUMNS: Record<keyof Order, string> = {
  id: 'id',
  userId: 'user_id',
  planId: 'plan_id',
  provider: 'provider',
  providerRef: 'provider_ref',
  status: 'status',
  amountIdr: 'amount_idr',
  createdAt: 'created_at',
  paidAt: 'paid_at',
};

export class PostgresStore implements Store {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    if (!connectionString) throw new Error('DATABASE_URL is required for the postgres driver');
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'cloudjava-api',
    });
    this.pool.on('error', (err) => logger.error({ err }, 'idle pg client error'));
  }

  async init(): Promise<void> {
    const { rows } = await this.pool.query('SELECT 1 AS ok');
    if (rows.length !== 1) throw new Error('postgres connectivity check failed');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createUser(input: NewUser): Promise<User> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES (lower($1), $2, $3) RETURNING *`,
        [input.email.trim(), input.passwordHash, input.role ?? 'user'],
      );
      return mapUser(rows[0] as Row);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw Object.assign(new Error('email already registered'), { code: 'EMAIL_TAKEN' });
      }
      throw err;
    }
  }

  async updateUserRole(id: string, role: UserRole): Promise<User | null> {
    const { rows } = await this.pool.query(
      'UPDATE users SET role = $2 WHERE id = $1 RETURNING *',
      [id, role],
    );
    return rows.length ? mapUser(rows[0] as Row) : null;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM users WHERE email = lower($1) LIMIT 1',
      [email.trim()],
    );
    return rows.length ? mapUser(rows[0] as Row) : null;
  }

  async findUserById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return rows.length ? mapUser(rows[0] as Row) : null;
  }

  async createInstance(input: NewInstance): Promise<Instance> {
    const { rows } = await this.pool.query(
      `INSERT INTO instances
         (user_id, plan_id, java_version, vnc_password, proxy_path, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'provisioning')
       RETURNING *`,
      [
        input.userId,
        input.planId,
        input.javaVersion,
        input.vncPassword,
        input.proxyPath,
        input.expiresAt,
      ],
    );
    return mapInstance(rows[0] as Row);
  }

  async getInstance(id: string): Promise<Instance | null> {
    const { rows } = await this.pool.query('SELECT * FROM instances WHERE id = $1', [id]);
    return rows.length ? mapInstance(rows[0] as Row) : null;
  }

  async listInstancesByUser(userId: string): Promise<Instance[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM instances WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows.map((r) => mapInstance(r as Row));
  }

  async listInstances(filter?: { status?: InstanceStatus[] }): Promise<Instance[]> {
    if (filter?.status?.length) {
      const { rows } = await this.pool.query(
        'SELECT * FROM instances WHERE status = ANY($1::text[]) ORDER BY created_at DESC',
        [filter.status],
      );
      return rows.map((r) => mapInstance(r as Row));
    }
    const { rows } = await this.pool.query('SELECT * FROM instances ORDER BY created_at DESC');
    return rows.map((r) => mapInstance(r as Row));
  }

  async updateInstance(id: string, patch: Partial<Instance>): Promise<Instance | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(INSTANCE_COLUMNS)) {
      if (key === 'id' || key === 'createdAt') continue;
      const value = (patch as Record<string, unknown>)[key];
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    sets.push('updated_at = now()');
    if (!values.length) {
      values.push(id);
      const { rows } = await this.pool.query(
        `UPDATE instances SET updated_at = now() WHERE id = $1 RETURNING *`,
        values,
      );
      return rows.length ? mapInstance(rows[0] as Row) : null;
    }
    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE instances SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return rows.length ? mapInstance(rows[0] as Row) : null;
  }

  async deleteInstance(id: string): Promise<void> {
    await this.pool.query('DELETE FROM instances WHERE id = $1', [id]);
  }

  async createOrder(input: NewOrder): Promise<Order> {
    const { rows } = await this.pool.query(
      `INSERT INTO orders (user_id, plan_id, provider, provider_ref, amount_idr, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
      [input.userId, input.planId, input.provider, input.providerRef, input.amountIdr],
    );
    return mapOrder(rows[0] as Row);
  }

  async getOrder(id: string): Promise<Order | null> {
    const { rows } = await this.pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    return rows.length ? mapOrder(rows[0] as Row) : null;
  }

  async findOrderByProviderRef(provider: string, providerRef: string): Promise<Order | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM orders WHERE provider = $1 AND provider_ref = $2 LIMIT 1',
      [provider, providerRef],
    );
    return rows.length ? mapOrder(rows[0] as Row) : null;
  }

  async updateOrder(id: string, patch: Partial<Order>): Promise<Order | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(ORDER_COLUMNS)) {
      if (key === 'id' || key === 'createdAt') continue;
      const value = (patch as Record<string, unknown>)[key];
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    if (!sets.length) return this.getOrder(id);
    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE orders SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return rows.length ? mapOrder(rows[0] as Row) : null;
  }
}
