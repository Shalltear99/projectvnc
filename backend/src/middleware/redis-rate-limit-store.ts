/**
 * Redis hit-counter store for express-rate-limit.
 *
 * docs/security.md mandates that the 5-attempts/minute login limit be
 * Redis-backed. In-process counters only work with a single API replica; with
 * REDIS_URL configured, per-IP counters must be shared across instances or a
 * brute-forcer simply rotates between replicas. The store is a fixed-window
 * INCR + PEXPIRE counter — the same semantics as the built-in MemoryStore.
 *
 * Fail-open on Redis errors (rate-limiting is defence in depth; taking the API
 * down because the limiter's cache is down would be worse). Express-rate-limit
 * has the same default via its passOnStoreError option.
 */
import type { ClientRateLimitInfo, Store } from 'express-rate-limit';
import type Redis from 'ioredis';

/** Lua: atomic increment + expiry, so a crashed client cannot leak keys. */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {hits, ttl}
`;

export class RedisRateLimitStore implements Store {
  /** Set by init() — the windowMs of the limiter using this store. */
  private windowMs = 60_000;
  /** Injectable for tests. */
  private readonly redis: Redis;
  /** True when the client factory was passed a full redis URL etc. */
  readonly locationKeyPrefix: string;

  constructor(options: { redis: Redis; prefix?: string }) {
    this.redis = options.redis;
    this.locationKeyPrefix = options.prefix ?? 'cloudjava:rl:';
    this.redis.defineCommand('cloudjavaRlIncrement', {
      numberOfKeys: 1,
      lua: INCREMENT_SCRIPT,
    });
  }

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      const client = this.redis as unknown as {
        cloudjavaRlIncrement: (key: string, arg: string) => Promise<[number, number]>;
      };
      const [hits, ttl] = await client.cloudjavaRlIncrement(this.locationKeyPrefix + key, String(this.windowMs));
      return {
        totalHits: hits,
        resetTime: ttl >= 0 ? new Date(Date.now() + ttl) : undefined,
      };
    } catch {
      // Fail open, but return a number that cannot block the request.
      return { totalHits: 0, resetTime: undefined };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      // Never go below zero (e.g. two decrement races on a fresh key).
      await this.redis.decr(this.locationKeyPrefix + key);
    } catch {
      // Redis down: nothing useful to do; the next increment wins.
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.redis.del(this.locationKeyPrefix + key);
    } catch {
      // ignore
    }
  }

  async resetAll(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.locationKeyPrefix}*`);
      if (keys.length) await this.redis.del(...keys);
    } catch {
      // ignore
    }
  }

  /** Keys are shared across replicas by design — that is the point. */
  readonly unsharedStore = false;

  shutdown(): void {
    // The connection is owned by the caller (see rate-limit.ts); do not quit it here.
  }
}
