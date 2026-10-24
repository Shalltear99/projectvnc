/**
 * Agent lifecycle. One switch (`ENABLE_AGENTS`) turns the whole autonomous layer
 * off, which is what a read-only API replica or a maintenance window needs.
 */
import { config } from '../config';
import { logger } from '../logger';
import { getJanitorAgent, type JanitorSummary } from './janitor.agent';
import { getMetricsAgent } from './metrics.agent';
import { getProvisionerAgent } from './provisioner.agent';

export { getJanitorAgent, getMetricsAgent, getProvisionerAgent };
export type { JanitorSummary };

let started = false;

export async function startAllAgents(): Promise<void> {
  if (started) return;
  if (!config.agents.enabled) {
    logger.warn('ENABLE_AGENTS=false — provisioning, metrics and janitor are disabled');
    return;
  }
  await getProvisionerAgent().start();
  await getMetricsAgent().start();
  await getJanitorAgent().start();
  started = true;
  logger.info('all agents started');
}

export async function stopAllAgents(): Promise<void> {
  if (!started) return;
  // Stop the janitor first: it must not reap instances while the provisioner is
  // mid-flight during shutdown.
  await getJanitorAgent().stop();
  await getMetricsAgent().stop();
  await getProvisionerAgent().stop();
  started = false;
  logger.info('all agents stopped');
}

export interface AgentStatus {
  enabled: boolean;
  provisioner: boolean;
  metrics: ReturnType<ReturnType<typeof getMetricsAgent>['status']>;
  janitor: ReturnType<ReturnType<typeof getJanitorAgent>['status']>;
}

export function getAgentStatus(): AgentStatus {
  return {
    enabled: config.agents.enabled,
    provisioner: getProvisionerAgent().isRunning(),
    metrics: getMetricsAgent().status(),
    janitor: getJanitorAgent().status(),
  };
}
