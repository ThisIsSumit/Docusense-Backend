import { Redis } from 'ioredis';
import { config } from './config';
import { logger } from '../shared/utils/logger';

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
     });

    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('error', (err) => logger.error({ err }, 'Redis error'));
    redisClient.on('reconnecting', () => logger.warn('Redis reconnecting'));
  }
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

// Typed helpers
export const redis = {
  get: (key: string) => getRedis().get(key),
  set: (key: string, value: string, ttlSeconds?: number) =>
    ttlSeconds
      ? getRedis().set(key, value, 'EX', ttlSeconds)
      : getRedis().set(key, value),
  del: (...keys: string[]) => getRedis().del(...keys),
  exists: (key: string) => getRedis().exists(key),
  ttl: (key: string) => getRedis().ttl(key),
  incr: (key: string) => getRedis().incr(key),
  sadd: (key: string, ...members: string[]) => getRedis().sadd(key, ...members),
  sismember: (key: string, member: string) => getRedis().sismember(key, member),
};
