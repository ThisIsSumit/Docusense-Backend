import { createApp } from './app';
import { connectDB, disconnectDB } from './config/database';
import { getRedis, disconnectRedis } from './config/redis';
import { config } from './config/config';
import { logger } from './shared/utils/logger';
import { startWorkers, WorkerRuntime } from './jobs/worker';

async function bootstrap() {
  let workerRuntime: WorkerRuntime | null = null;

  // Connect dependencies
  logger.info('Connecting to database...');
  await connectDB();
  logger.info('✓ Database connected');

  // Warm Redis connection
  const redis = getRedis();
  await redis.ping();
  logger.info('✓ Redis connected');

  if (config.RUN_WORKER_INLINE) {
    workerRuntime = await startWorkers({
      manageDatabaseConnection: false,
      registerSignalHandlers: false,
    });
    logger.info('✓ Inline worker started in API service');
  } else {
    logger.warn('Inline worker disabled; queued AI jobs require a separate worker process');
  }

  // Start server
  const app = createApp();
  const server = app.listen(config.PORT, () => {
    logger.info(
      {
        port: config.PORT,
        env: config.NODE_ENV,
        prefix: config.API_PREFIX,
      },
      `🚀 DocuSense API running on port ${config.PORT}`,
    );
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  let isShuttingDown = false;

  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Shutdown signal received');

    server.close(async () => {
      logger.info('HTTP server closed');
      try {
        if (workerRuntime) {
          await workerRuntime.close();
        }
        await disconnectDB();
        await disconnectRedis();
        logger.info('Connections closed — bye!');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
    shutdown('unhandledRejection');
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
