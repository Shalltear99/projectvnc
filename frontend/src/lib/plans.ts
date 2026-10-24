import type { Plan } from './types';

/**
 * Fallback catalogue used by the landing page and the create-instance form when
 * the backend plan endpoint is unavailable. Prices in IDR, durations in minutes
 * (docs/prd.md FR-4.2).
 */
export const PLANS: readonly Plan[] = [
  {
    id: 'daily',
    name: 'Daily',
    priceIdr: 15000,
    durationMinutes: 1440,
    blurb: 'A day pass for trying a build or a quick session.',
    highlights: ['1,440 minutes of runtime', 'OpenJDK 8 – 21', 'Browser VNC, no install'],
  },
  {
    id: 'weekly',
    name: 'Weekly',
    priceIdr: 75000,
    durationMinutes: 10080,
    blurb: 'The usual pick for game sessions and bot runs.',
    highlights: ['10,080 minutes of runtime', 'Priority worker placement', 'Snapshot reset on demand'],
    featured: true,
  },
  {
    id: 'monthly',
    name: 'Monthly',
    priceIdr: 250000,
    durationMinutes: 43200,
    blurb: 'Always-on instances for 24/7 workloads.',
    highlights: ['43,200 minutes of runtime', 'Longest retention window', 'Lowest cost per hour'],
  },
];

export const JAVA_VERSIONS: readonly string[] = ['8', '11', '17', '21'];

export function getPlan(planId: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === planId);
}

export function formatIdr(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDuration(minutes: number): string {
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440);
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} min`;
}
