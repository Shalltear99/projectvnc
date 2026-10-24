/**
 * Event bus. Redis pub/sub in production (docs/architecture.md §2.2) with an
 * in-process fallback so the platform runs — and is testable — without Redis.
 */
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';

export interface EventPayloads {
  ORDER_PAID: { orderId: string; userId: string; planId: string };
  INSTANCE_READY: { instanceId: string; userId: string; proxyPath: string };
  INSTANCE_REBUILD: { instanceId: string };
  PROVISIONING_FAILED: { instanceId: string; reason: string };
  INSTANCE_EXPIRED: { instanceId: string; userId: string };
  INSTANCE_IDLE: { instanceId: string; idleMs: number };
  SECURITY_ALERT: { instanceId: string; kind: string; detail: string };
}

export type EventTopic = keyof EventPayloads;
export type EventHandler<K extends EventTopic> = (payload: EventPayloads[K]) => void | Promise<void>;

export interface EventBus {
  publish<K extends EventTopic>(topic: K, payload: EventPayloads[K]): Promise<void>;
  subscribe<K extends EventTopic>(topic: K, handler: EventHandler<K>): Promise<void>;
  close(): Promise<void>;
}

export class LocalEventBus implements EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  async publish<K extends EventTopic>(topic: K, payload: EventPayloads[K]): Promise<void> {
    logger.debug({ topic, payload }, 'event published (local)');
    // Handlers are isolated: one throwing agent must not break the publisher.
    for (const listener of this.emitter.listeners(topic)) {
      try {
        await (listener as (p: EventPayloads[K]) => void | Promise<void>)(payload);
      } catch (err) {
        logger.error({ err, topic }, 'event handler failed');
      }
    }
  }

  async subscribe<K extends EventTopic>(topic: K, handler: EventHandler<K>): Promise<void> {
    this.emitter.on(topic, handler as (p: EventPayloads[K]) => void);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

export class RedisEventBus implements EventBus {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly handlers = new Map<string, Set<(raw: string) => void>>();

  constructor(url: string) {
    this.publisher = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.subscriber = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.publisher.on('error', (err) => logger.error({ err }, 'redis publisher error'));
    this.subscriber.on('error', (err) => logger.error({ err }, 'redis subscriber error'));
    this.subscriber.on('message', (channel: string, message: string) => {
      for (const fn of this.handlers.get(channel) ?? []) fn(message);
    });
  }

  async publish<K extends EventTopic>(topic: K, payload: EventPayloads[K]): Promise<void> {
    await this.publisher.publish(`cloudjava:${topic}`, JSON.stringify(payload));
  }

  async subscribe<K extends EventTopic>(topic: K, handler: EventHandler<K>): Promise<void> {
    const channel = `cloudjava:${topic}`;
    const set = this.handlers.get(channel) ?? new Set();
    set.add((raw: string) => {
      try {
        const payload = JSON.parse(raw) as EventPayloads[K];
        void Promise.resolve(handler(payload)).catch((err) =>
          logger.error({ err, topic }, 'event handler failed'),
        );
      } catch (err) {
        logger.error({ err, topic, raw }, 'malformed event payload');
      }
    });
    this.handlers.set(channel, set);
    await this.subscriber.subscribe(channel);
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }
}

export function createEventBus(): EventBus {
  if (config.redisUrl) {
    logger.info('event bus: redis');
    return new RedisEventBus(config.redisUrl);
  }
  logger.info('event bus: local (in-process)');
  return new LocalEventBus();
}

export const eventBus: EventBus = createEventBus();
