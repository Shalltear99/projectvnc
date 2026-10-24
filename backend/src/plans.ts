/**
 * Plan catalogue (docs/prd.md §4.4). Kept in code: prices change by deploy,
 * not by user, and every quote must be reproducible server-side.
 */
import type { Plan } from './types';

export const PLANS: readonly Plan[] = [
  {
    id: 'plan_daily',
    code: 'daily',
    name: 'Daily Pass',
    priceIdr: 15_000,
    durationMinutes: 60 * 24,
    javaVersion: 17,
    cpuCores: 1,
    memoryMb: 1024,
    maxConcurrent: 1,
  },
  {
    id: 'plan_weekly',
    code: 'weekly',
    name: 'Weekly Pass',
    priceIdr: 75_000,
    durationMinutes: 60 * 24 * 7,
    javaVersion: 17,
    cpuCores: 1,
    memoryMb: 1536,
    maxConcurrent: 2,
  },
  {
    id: 'plan_monthly',
    code: 'monthly',
    name: 'Monthly Pass',
    priceIdr: 250_000,
    durationMinutes: 60 * 24 * 30,
    javaVersion: 21,
    cpuCores: 2,
    memoryMb: 2048,
    maxConcurrent: 2,
  },
] as const;

export function findPlan(planId: string): Plan | null {
  return PLANS.find((p) => p.id === planId || p.code === planId) ?? null;
}
