/**
 * Provider selection.
 *
 * Selection is strict on purpose: a production deployment that names a provider
 * but has no credentials for it must fail loudly at boot, never quietly settle
 * orders through the mock gateway (which would hand out free instances).
 */
import { config } from '../../config';
import { MidtransProvider } from './midtrans.provider';
import { MockPaymentProvider } from './mock.provider';
import { TripayProvider, tripayApiKeyFromEnv } from './tripay.provider';
import { XenditProvider, xenditApiKeyFromEnv } from './xendit.provider';
import type { PaymentProvider, PaymentProviderName } from './types';

export type {
  CheckoutInput,
  CheckoutResult,
  PaymentProvider,
  PaymentProviderName,
  WebhookHeaders,
  WebhookResult,
  WebhookStatus,
} from './types';

const cache = new Map<PaymentProviderName, PaymentProvider>();

function build(name: PaymentProviderName): PaymentProvider {
  switch (name) {
    case 'mock':
      return new MockPaymentProvider();
    case 'midtrans':
      return new MidtransProvider(config.payments.midtransServerKey);
    case 'xendit':
      return new XenditProvider(config.payments.xenditCallbackToken, xenditApiKeyFromEnv());
    case 'tripay':
      return new TripayProvider(
        config.payments.tripayPrivateKey,
        config.payments.tripayMerchantCode,
        tripayApiKeyFromEnv(),
      );
    default: {
      // Exhaustiveness guard: adding a provider to the union without a case here
      // is a compile error rather than a runtime surprise.
      const unreachable: never = name;
      throw new Error(`[payments] unknown provider: ${String(unreachable)}`);
    }
  }
}

/**
 * @param name defaults to the configured provider. Passing an explicit name is
 *   only legitimate for webhook verification, where the URL determines it — and
 *   even then it must equal the configured provider (checked by the caller).
 */
export function getPaymentProvider(name: PaymentProviderName = config.payments.provider): PaymentProvider {
  const cached = cache.get(name);
  if (cached) return cached;
  const provider = build(name);
  cache.set(name, provider);
  return provider;
}

export function isMockProvider(): boolean {
  return config.payments.provider === 'mock';
}
