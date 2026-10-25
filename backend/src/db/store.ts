/**
 * Persistence contract. Two drivers implement it: `memory` (dev/tests) and
 * `postgres` (production). Routes and agents only ever see this interface, so
 * swapping drivers cannot change control-plane behaviour.
 */
import { config } from '../config';
import { logger } from '../logger';
import type { Instance, InstanceStatus, Order, User, UserRole } from '../types';
import { MemoryStore } from './memory.store';
import { PostgresStore } from './postgres.store';

export interface NewUser {
  email: string;
  passwordHash: string;
  role?: UserRole;
}

export interface NewInstance {
  userId: string;
  planId: string;
  javaVersion: number;
  vncPassword: string;
  expiresAt: string;
  proxyPath: string;
}

export interface NewOrder {
  userId: string;
  planId: string;
  provider: string;
  providerRef: string;
  amountIdr: number;
}

export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;

  createUser(input: NewUser): Promise<User>;
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  /** Used by the admin bootstrap to promote an existing account idempotently. */
  updateUserRole(id: string, role: UserRole): Promise<User | null>;

  createInstance(input: NewInstance): Promise<Instance>;
  getInstance(id: string): Promise<Instance | null>;
  listInstancesByUser(userId: string): Promise<Instance[]>;
  listInstances(filter?: { status?: InstanceStatus[] }): Promise<Instance[]>;
  updateInstance(id: string, patch: Partial<Instance>): Promise<Instance | null>;
  deleteInstance(id: string): Promise<void>;

  createOrder(input: NewOrder): Promise<Order>;
  getOrder(id: string): Promise<Order | null>;
  findOrderByProviderRef(provider: string, providerRef: string): Promise<Order | null>;
  updateOrder(id: string, patch: Partial<Order>): Promise<Order | null>;
}

let store: Store | null = null;

export function getStore(): Store {
  if (!store) throw new Error('store not initialised — call initStore() first');
  return store;
}

export async function initStore(): Promise<Store> {
  if (store) return store;
  store = config.db.driver === 'postgres'
    ? new PostgresStore(config.db.url ?? '')
    : new MemoryStore();
  await store.init();
  logger.info({ driver: config.db.driver }, 'store ready');
  return store;
}

export async function closeStore(): Promise<void> {
  if (!store) return;
  await store.close();
  store = null;
}
