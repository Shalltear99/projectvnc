/**
 * Process entrypoint.
 *
 * Boot order is fixed: the store must exist before anything reads it, and the
 * allocator/proxy must be rebuilt from durable state BEFORE agents start —
 * otherwise the first provisioned instance could be handed a port that an
 * instance from a previous process still owns.
 */
import type { Server } from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { closeStore, getStore, initStore } from './db/store';
import { eventBus } from './events/bus';
import { logger } from './logger';
import { getPortAllocator } from './services/ports';
import { getProxyRouter } from './services/proxy-router';
import { startAllAgents, stopAllAgents } from './agents';
import { closeRateLimitRedis } from './middleware/rate-limit';
import { ensureAdminUser } from './services/admin-bootstrap';

let server: Server | null = null;
let shuttingDown = false;

async function boot(): Promise<void> {
  await initStore();

  // Seed the admin account (if configured) before the HTTP listener opens, so a
  // client can never observe the API in a half-provisioned state.
  await ensureAdminUser();

  // Rebuild in-memory reservations from the rows that are still live.
  await getPortAllocator().sync();

  const live = await getStore().listInstances({ status: ['running'] });
  await getProxyRouter().sync(
    live
      .filter((i): i is typeof i & { wsPort: number } => typeof i.wsPort === 'number')
      .map((i) => ({ instanceId: i.id, wsPort: i.wsPort })),
  );

  await startAllAgents();

  const app = createApp();
  server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.env, db: config.db.driver, docker: config.docker.driver, proxy: config.proxy.mode },
      'cloudjava api listening',
    );
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn({ signal }, 'shutting down');

  // Hard deadline: a hung Docker call or a wedged pg socket must not keep the
  // container alive until the orchestrator SIGKILLs it.
  const force = setTimeout(() => {
    logger.error('graceful shutdown timed out after 10s — forcing exit');
    process.exit(1);
  }, 10_000);
  force.unref();

  try {
    await stopAllAgents();
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
        // Keep-alive sockets would otherwise hold the server open for the full
        // client timeout.
        server?.closeIdleConnections?.();
      });
    }
    await closeStore();
    await closeRateLimitRedis();
    await eventBus.close();
    clearTimeout(force);
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  // Log and keep serving: the process supervisor restarts us, and an immediate
  // exit would drop in-flight webhook responses.
  logger.error({ err }, 'uncaught exception');
});

boot().catch((err) => {
  logger.error({ err }, 'fatal boot error');
  process.exit(1);
});
