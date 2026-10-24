/**
 * Rate limiting (docs/security.md — brute-force row: 5 login attempts/minute/IP,
 * Redis-backed). With REDIS_URL set the counters live in Redis so a brute-forcer
 * cannot rotate between replicas; without it we fall back to the built-in
 * MemoryStore, which is correct for the single-process compose deployment.
 */
import rateLimit, { type Options, type RateLimitRequestHandler } from 'express-rate-limit';
import Redis from 'ioredis';
import type { Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../logger';
import { RedisRateLimitStore } from './redis-rate-limit-store';

let sharedRedis: Redis | null = null;
let redisStore: RedisRateLimitStore | null = null;

if (config.redisUrl) {
  sharedRedis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  sharedRedis.on('error', (err) => logger.error({ err }, 'rate-limit redis error'));
  sharedRedis.connect().catch((err) => logger.error({ err }, 'rate-limit redis connect failed'));
  redisStore = new RedisRateLimitStore({ redis: sharedRedis });
  logger.info('rate limiting: redis-backed');
} else {
  logger.info('rate limiting: in-memory (single-instance mode)');
}

/** One shared Redis client/store for all limiters; process owns the connection. */
export function closeRateLimitRedis(): Promise<void> {
  return sharedRedis ? sharedRedis.quit().then(() => undefined).catch(() => undefined) : Promise.resolve();
}

function limiter(overrides: Partial<Options> & Pick<Options, 'limit' | 'windowMs'>): RateLimitRequestHandler {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Redis down must not take the API down; MemoryStore never errors anyway.
    passOnStoreError: true,
    ...(redisStore ? { store: redisStore } : {}),
    handler: (_req: Request, res: Response) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'too many attempts, retry in a minute' } }),
    ...overrides,
  });
}

/** Credential endpoints: 5 attempts per minute per IP, successes included. */
export const loginLimiter: RateLimitRequestHandler = limiter({
  windowMs: 60_000,
  limit: 5,
  // Registration is just as attractive to a scripted attacker as login.
  skipSuccessfulRequests: false,
});

/** General API ceiling: generous for a dashboard, hostile to enumeration. */
export const apiLimiter: RateLimitRequestHandler = limiter({
  windowMs: 60_000,
  limit: 300,
  handler: (_req: Request, res: Response) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'too many requests' } }),
});
