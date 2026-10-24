/**
 * Payment provider contract.
 *
 * Two independent halves that must never be conflated:
 *   * createCheckout — outbound, authenticated with our own credentials, returns
 *     a hosted payment page the browser is redirected to.
 *   * verifyWebhook — inbound, authenticated with the provider's signature, is
 *     the ONLY thing allowed to settle an order.
 *
 * A webhook is untrusted input from the internet: `ok:false` means "do not act",
 * and the raw bytes are what gets hashed, never a re-serialised object.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Order, Plan, User } from '../../types';

export type PaymentProviderName = 'mock' | 'midtrans' | 'xendit' | 'tripay';

export interface CheckoutInput {
  /**
   * Provisional order: the row is written only after the provider hands back a
   * reference, so `order.id` here is the reference we propose to the provider.
   */
  order: Order;
  plan: Plan;
  user: User;
}

export interface CheckoutResult {
  providerRef: string;
  checkoutUrl: string;
  expiresAt: string;
}

export type WebhookStatus = 'paid' | 'failed' | 'expired';

export interface WebhookResult {
  /** Signature valid AND payload well-formed. False => reject with 401. */
  ok: boolean;
  providerRef: string;
  status: WebhookStatus;
  amountIdr: number;
  reason?: string;
  /**
   * Authentic but non-terminal (e.g. Midtrans "pending"). The route answers 200
   * so the provider stops retrying, but nothing is settled.
   */
  ignored?: boolean;
}

/** Header bag as received; Node lowercases names but we normalise anyway. */
export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyWebhook(headers: WebhookHeaders, rawBody: Buffer): WebhookResult;
}

/** How long a hosted payment page stays payable. */
export const PAYMENT_WINDOW_MINUTES = 30;

export function header(headers: WebhookHeaders, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
  return null;
}

/** Constant-time string comparison; length mismatch is a rejection, not a throw. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function toAmountIdr(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw === 'string') {
    // Providers send "15000.00"; parseFloat stops at the dot.
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return Number.NaN;
}
