/**
 * In-memory store — development and integration-test driver. Single process,
 * data lost on restart; never selectable in production (config guards it).
 */
import { randomUUID } from 'node:crypto';
import type { Instance, InstanceStatus, Order, User, UserRole } from '../types';
import type { NewInstance, NewOrder, NewUser, Store } from './store';

const clone = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();

export class MemoryStore implements Store {
  private users = new Map<string, User>();
  private instances = new Map<string, Instance>();
  private orders = new Map<string, Order>();

  async init(): Promise<void> {
    /* nothing to do */
  }

  async close(): Promise<void> {
    this.users.clear();
    this.instances.clear();
    this.orders.clear();
  }

  async createUser(input: NewUser): Promise<User> {
    const email = input.email.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.email === email) {
        throw Object.assign(new Error('email already registered'), { code: 'EMAIL_TAKEN' });
      }
    }
    const user: User = {
      id: randomUUID(),
      email,
      passwordHash: input.passwordHash,
      role: input.role ?? 'user',
      createdAt: now(),
      suspendedAt: null,
    };
    this.users.set(user.id, user);
    return clone(user);
  }

  async updateUserRole(id: string, role: UserRole): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;
    user.role = role;
    return clone(user);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const target = email.trim().toLowerCase();
    for (const u of this.users.values()) if (u.email === target) return clone(u);
    return null;
  }

  async findUserById(id: string): Promise<User | null> {
    const u = this.users.get(id);
    return u ? clone(u) : null;
  }

  async createInstance(input: NewInstance): Promise<Instance> {
    const ts = now();
    const instance: Instance = {
      id: randomUUID(),
      userId: input.userId,
      planId: input.planId,
      containerId: null,
      wsPort: null,
      vncPort: null,
      status: 'provisioning',
      javaVersion: input.javaVersion,
      vncPassword: input.vncPassword,
      proxyPath: input.proxyPath,
      lastActivityAt: ts,
      createdAt: ts,
      updatedAt: ts,
      expiresAt: input.expiresAt,
      failureReason: null,
    };
    this.instances.set(instance.id, instance);
    return clone(instance);
  }

  async getInstance(id: string): Promise<Instance | null> {
    const i = this.instances.get(id);
    return i ? clone(i) : null;
  }

  async listInstancesByUser(userId: string): Promise<Instance[]> {
    return [...this.instances.values()]
      .filter((i) => i.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async listInstances(filter?: { status?: InstanceStatus[] }): Promise<Instance[]> {
    const all = [...this.instances.values()];
    const rows = filter?.status?.length
      ? all.filter((i) => filter.status!.includes(i.status))
      : all;
    return rows.map(clone);
  }

  async updateInstance(id: string, patch: Partial<Instance>): Promise<Instance | null> {
    const current = this.instances.get(id);
    if (!current) return null;
    const next: Instance = {
      ...current,
      ...patch,
      id: current.id,
      userId: current.userId,
      createdAt: current.createdAt,
      updatedAt: now(),
    };
    this.instances.set(id, next);
    return clone(next);
  }

  async deleteInstance(id: string): Promise<void> {
    this.instances.delete(id);
  }

  async createOrder(input: NewOrder): Promise<Order> {
    const order: Order = {
      id: randomUUID(),
      userId: input.userId,
      planId: input.planId,
      provider: input.provider,
      providerRef: input.providerRef,
      status: 'pending',
      amountIdr: input.amountIdr,
      createdAt: now(),
      paidAt: null,
    };
    this.orders.set(order.id, order);
    return clone(order);
  }

  async getOrder(id: string): Promise<Order | null> {
    const o = this.orders.get(id);
    return o ? clone(o) : null;
  }

  async findOrderByProviderRef(provider: string, providerRef: string): Promise<Order | null> {
    for (const o of this.orders.values()) {
      if (o.provider === provider && o.providerRef === providerRef) return clone(o);
    }
    return null;
  }

  async updateOrder(id: string, patch: Partial<Order>): Promise<Order | null> {
    const current = this.orders.get(id);
    if (!current) return null;
    const next: Order = { ...current, ...patch, id: current.id };
    this.orders.set(id, next);
    return clone(next);
  }
}
