import rateLimit from 'express-rate-limit';
import { config } from '../config/config';
import { getRedis } from '../config/redis';

// ── General API limiter ───────────────────────────────────────────────────────
export const apiLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many requests, please try again later',
    error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
  },
  keyGenerator: (req) => req.user?.sub ?? req.ip ?? 'unknown',
});

// ── Auth limiter (stricter) ───────────────────────────────────────────────────
export const authLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many auth attempts, please try again later',
    error: { code: 'RATE_LIMITED', message: 'Too many auth attempts, please try again later' },
  },
  skipSuccessfulRequests: true,
});

// ── Upload limiter ────────────────────────────────────────────────────────────
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Upload limit reached, please try again in an hour',
    error: { code: 'RATE_LIMITED', message: 'Upload limit reached, please try again in an hour' },
  },
  keyGenerator: (req) => req.user?.sub ?? req.ip ?? 'unknown',
});
