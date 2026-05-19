import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';

import { config } from './config/config';
import { logger } from './shared/utils/logger';
import { errorHandler, notFound } from './middleware/error.middleware';
import { apiLimiter } from './middleware/rate-limit.middleware';

import { authRouter } from './modules/auth/auth.routes';
import { documentsRouter } from './modules/documents/documents.routes';
import { searchRouter } from './modules/search/search.routes';
import { usersRouter } from './modules/users/users.routes';

export function createApp() {
  const app = express();

  // ── Security ────────────────────────────────────────────────────────────────
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: config.NODE_ENV === 'production',
    }),
  );

  app.use(
    cors({
      origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['X-Total-Count', 'X-Request-Id'],
    }),
  );

  // ── Compression ─────────────────────────────────────────────────────────────
  app.use(compression());

  // ── Body parsing ────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── Logging ─────────────────────────────────────────────────────────────────
  if (config.NODE_ENV !== 'test') {
    app.use(
      morgan('combined', {
        stream: { write: (msg) => logger.info(msg.trim()) },
        skip: (req) => req.url === '/health',
      }),
    );
  }

  // ── Request ID ──────────────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    req.headers['x-request-id'] ??= crypto.randomUUID();
    next();
  });

  // ── Static file serving (local storage) ────────────────────────────────────
  if (config.STORAGE_PROVIDER === 'local') {
    app.use(
      '/files',
      express.static(path.resolve(config.STORAGE_LOCAL_PATH), {
        dotfiles: 'deny',
        maxAge: '1d',
      }),
    );
  }

  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      env: config.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  // ── API Routes ──────────────────────────────────────────────────────────────
  const api = express.Router();
  api.use(apiLimiter);

  api.use('/auth', authRouter);
  api.use('/documents', documentsRouter);
  api.use('/search', searchRouter);
  api.use('/users', usersRouter);

  app.use(config.API_PREFIX, api);

  // ── 404 + Error Handling ────────────────────────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
