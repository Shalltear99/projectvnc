/**
 * Typed, validated configuration. The process refuses to boot on a bad value
 * rather than failing later at request time (docs/onboarding.md §4).
 */
import 'dotenv/config';
import { z } from 'zod';

const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000, 1, 65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),

  DATABASE_DRIVER: z.enum(['memory', 'postgres']).default('memory'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  // Optional admin seed, applied at boot (see services/admin-bootstrap.ts).
  // Unset is the normal case; there is deliberately no HTTP route that can
  // grant the admin role.
  // Empty string must mean "unset", not "invalid email": `ADMIN_EMAIL=` in a
  // compose file or shell export is a normal way to disable the seed, and
  // failing validation there would take the whole API down at boot.
  ADMIN_EMAIL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().email().optional(),
  ),
  ADMIN_PASSWORD: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),

  JWT_SECRET: z.string().min(16).default('dev-only-change-me-32-characters-minimum'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  VNC_TOKEN_SECRET: z.string().min(16).default('dev-only-vnc-token-secret-change-me'),
  VNC_TOKEN_TTL_SECONDS: int(120, 30, 3600),

  DOCKER_DRIVER: z.enum(['docker', 'mock']).default('mock'),
  DOCKER_SOCKET: z.string().default('/var/run/docker.sock'),
  WORKER_IMAGE: z.string().default('cloudjava-worker:latest'),
  PROVISION_TIMEOUT_MS: int(5000, 1000, 60000),
  VNC_PORT_RANGE_START: int(5900, 1024, 65000),
  VNC_PORT_RANGE_END: int(6000, 1024, 65000),
  WS_PORT_RANGE_START: int(6000, 1024, 65000),
  WS_PORT_RANGE_END: int(7000, 1024, 65000),
  INSTANCE_DEFAULT_TTL_MINUTES: int(1440, 5, 525600),
  MAX_INSTANCES_PER_USER: int(2, 1, 100),

  INSTANCE_CPU_LIMIT: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 1))
    .pipe(z.number().positive().max(64)),
  INSTANCE_MEMORY_MB: int(1024, 128, 65536),
  INSTANCE_PIDS_LIMIT: int(256, 32, 8192),
  INSTANCE_DISK_MB: int(2048, 128, 102400),

  JANITOR_INTERVAL_MS: int(60000, 5000, 3600000),
  METRICS_INTERVAL_MS: int(2000, 500, 60000),
  INACTIVE_STREAM_TIMEOUT_MS: int(900000, 60000, 86400000),
  ABUSE_CPU_PERCENT: int(95, 50, 100),
  ABUSE_SUSTAIN_MS: int(300000, 30000, 3600000),

  PROXY_MODE: z.enum(['nginx', 'noop']).default('noop'),
  NGINX_MAP_FILE: z.string().default('/etc/nginx/conf.d/cloudjava_upstreams.map'),
  NGINX_RELOAD_CMD: z.string().default('nginx -s reload'),
  STREAM_PATH_PREFIX: z.string().default('/vnc-stream'),

  PAYMENT_PROVIDER: z.enum(['mock', 'midtrans', 'xendit', 'tripay']).default('mock'),
  PAYMENT_MODE: z.enum(['auto', 'manual']).default('auto'),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  XENDIT_CALLBACK_TOKEN: z.string().optional(),
  TRIPAY_PRIVATE_KEY: z.string().optional(),
  TRIPAY_MERCHANT_CODE: z.string().optional(),
  MOCK_PAYMENT_SECRET: z.string().default('mock-payment-secret'),

  ENABLE_AGENTS: boolish(true),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const detail = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`[config] invalid environment:\n${detail}`);
  process.exit(78); // EX_CONFIG
}

const env = parsed.data;

if (env.VNC_PORT_RANGE_END > env.WS_PORT_RANGE_START) {
  // The spec deliberately keeps 5900-6000 (RFB) and 6000-7000 (websockify)
  // adjacent; overlapping ranges would hand the same port to two protocols.
  process.stderr.write('[config] warning: VNC and WS port ranges overlap\n');
}
if (env.NODE_ENV === 'production') {
  if (env.DOCKER_DRIVER === 'mock') {
    process.stderr.write('[config] FATAL: DOCKER_DRIVER=mock is forbidden in production\n');
    process.exit(78);
  }
  if (env.JWT_SECRET.startsWith('dev-only') || env.VNC_TOKEN_SECRET.startsWith('dev-only')) {
    process.stderr.write('[config] FATAL: default secrets are forbidden in production\n');
    process.exit(78);
  }
  if (env.DATABASE_DRIVER === 'memory') {
    process.stderr.write('[config] FATAL: DATABASE_DRIVER=memory is forbidden in production\n');
    process.exit(78);
  }
}

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  // `same-origin` means "we are served by the same nginx that proxies us, so
  // build no absolute urls and reflect no CORS origin". Empty string is the
  // sentinel the rest of the code checks for; see `config.publicBaseUrl === ''`.
  publicBaseUrl:
    env.PUBLIC_BASE_URL === 'same-origin' ? '' : env.PUBLIC_BASE_URL.replace(/\/+$/, ''),

  admin: {
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
  },

  db: {
    driver: env.DATABASE_DRIVER,
    url: env.DATABASE_URL,
  },
  redisUrl: env.REDIS_URL || null,

  auth: {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    vncTokenSecret: env.VNC_TOKEN_SECRET,
    vncTokenTtlSeconds: env.VNC_TOKEN_TTL_SECONDS,
  },

  docker: {
    driver: env.DOCKER_DRIVER,
    socketPath: env.DOCKER_SOCKET,
    workerImage: env.WORKER_IMAGE,
    provisionTimeoutMs: env.PROVISION_TIMEOUT_MS,
  },

  ports: {
    vnc: { start: env.VNC_PORT_RANGE_START, end: env.VNC_PORT_RANGE_END },
    ws: { start: env.WS_PORT_RANGE_START, end: env.WS_PORT_RANGE_END },
  },

  instances: {
    defaultTtlMinutes: env.INSTANCE_DEFAULT_TTL_MINUTES,
    maxPerUser: env.MAX_INSTANCES_PER_USER,
    limits: {
      cpus: env.INSTANCE_CPU_LIMIT,
      memoryMb: env.INSTANCE_MEMORY_MB,
      pids: env.INSTANCE_PIDS_LIMIT,
      diskMb: env.INSTANCE_DISK_MB,
    },
  },

  agents: {
    enabled: env.ENABLE_AGENTS,
    janitorIntervalMs: env.JANITOR_INTERVAL_MS,
    metricsIntervalMs: env.METRICS_INTERVAL_MS,
    inactiveStreamTimeoutMs: env.INACTIVE_STREAM_TIMEOUT_MS,
    abuseCpuPercent: env.ABUSE_CPU_PERCENT,
    abuseSustainMs: env.ABUSE_SUSTAIN_MS,
  },

  proxy: {
    mode: env.PROXY_MODE,
    mapFile: env.NGINX_MAP_FILE,
    reloadCmd: env.NGINX_RELOAD_CMD,
    pathPrefix: env.STREAM_PATH_PREFIX,
  },

  payments: {
    provider: env.PAYMENT_PROVIDER,
    mode: env.PAYMENT_MODE,
    midtransServerKey: env.MIDTRANS_SERVER_KEY ?? '',
    xenditCallbackToken: env.XENDIT_CALLBACK_TOKEN ?? '',
    tripayPrivateKey: env.TRIPAY_PRIVATE_KEY ?? '',
    tripayMerchantCode: env.TRIPAY_MERCHANT_CODE ?? '',
    mockSecret: env.MOCK_PAYMENT_SECRET,
  },
} as const;

export type AppConfig = typeof config;
