/**
 * Admin & operations endpoints.
 *
 * /health is intentionally unauthenticated: it is the liveness probe used by the
 * compose healthcheck and the load balancer, and it exposes no tenant data. The
 * two data endpoints sit behind requireAdmin.
 */
import { Router } from 'express';
import { config } from '../config';
import { getStore } from '../db/store';
import { getAgentStatus, getJanitorAgent } from '../agents';
import { asyncHandler } from '../errors';
import { requireAdmin } from '../middleware/auth';
import { getDocker } from '../services/docker.service';
import { toInstanceView } from '../services/instance-view';

const router = Router();

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const docker = getDocker();
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      now: new Date().toISOString(),
      env: config.env,
      drivers: {
        store: config.db.driver,
        docker: docker.kind,
        proxy: config.proxy.mode,
        payment: config.payments.provider,
      },
      agents: getAgentStatus(),
    });
  }),
);

router.get(
  '/instances',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const docker = getDocker();
    const instances = await getStore().listInstances();
    const rows = await Promise.all(
      instances.map(async (instance) => {
        let containerState: string | null = null;
        if (instance.containerId) {
          try {
            const inspected = await docker.inspect(instance.containerId);
            containerState = inspected?.state ?? null;
          } catch {
            // Docker being unreachable is a reportable fact, not a failed request.
            containerState = 'unknown';
          }
        }
        return { ...toInstanceView(instance), containerState };
      }),
    );
    res.json({ instances: rows });
  }),
);

router.post(
  '/janitor/run',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const summary = await getJanitorAgent().runOnce();
    res.json({ summary });
  }),
);

export default router;
