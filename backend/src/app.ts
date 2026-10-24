/**
 * Express application factory.
 *
 * Middleware order matters and is not arbitrary:
 *   1. helmet + request logging        — cheap, applies to everything;
 *   2. CORS                            — preflight must not hit the routers;
 *   3. webhook route (express.raw)     — BEFORE any JSON parser, so signatures
 *                                        are computed over the exact bytes;
 *   4. /api/vnc/authorize              — BEFORE the JSON parser and BEFORE the
 *                                        general limiter: it is an nginx
 *                                        subrequest, has no body, and a stream
 *                                        reconnect must never be throttled;
 *   5. express.json                    — everything else;
 *   6. routers, 404, error handler.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { apiLimiter } from './middleware/rate-limit';
import adminRoutes from './routes/admin.routes';
import authRoutes from './routes/auth.routes';
import instanceRoutes from './routes/instances.routes';
import paymentRoutes, { webhookRouter } from './routes/payments.routes';
import vncRoutes from './routes/vnc.routes';

function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  // Only the dashboard origin may call the API with credentials. Reflecting an
  // arbitrary Origin together with Allow-Credentials would let any site drive
  // the user's session.
  if (origin && origin === config.publicBaseUrl) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

export function createApp(): Express {
  const app = express();

  // One trusted hop: nginx. Without this every client looks like 127.0.0.1 and
  // the per-IP login limiter would be global.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      // Health probes are noisy and carry no user data.
      autoLogging: { ignore: (req) => req.url === '/api/admin/health' },
    }),
  );
  app.use(cors);
  app.use(cookieParser());

  // Raw body for webhooks — mounted before express.json on purpose.
  app.use('/api/webhooks', express.raw({ type: '*/*', limit: '1mb' }), webhookRouter);

  // nginx auth_request target: no body, no session, no rate limit.
  app.use('/api/vnc', vncRoutes);

  app.use(express.json({ limit: '256kb' }));

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/instances', instanceRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
