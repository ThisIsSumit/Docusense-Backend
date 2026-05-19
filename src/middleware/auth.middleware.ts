import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/config';
import { redis } from '../config/redis';
import { UnauthorizedError } from '../shared/types/api.types';

export interface JwtPayload {
  sub: string;     // userId
  email: string;
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing authorization header');
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Access token expired');
    }
    throw new UnauthorizedError('Invalid access token');
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next();
  }
  try {
    const payload = jwt.verify(
      header.slice(7),
      config.JWT_ACCESS_SECRET,
    ) as JwtPayload;
    req.user = payload;
  } catch {
    // silently ignore
  }
  next();
}

// ── Token generation ──────────────────────────────────────────────────────────

export function generateAccessToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email }, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function generateRefreshToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email }, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyRefreshToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, config.JWT_REFRESH_SECRET) as JwtPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
}

// ── Blacklist (for logout) ────────────────────────────────────────────────────

const BLACKLIST_PREFIX = 'bl:';
const ACCESS_TTL = 15 * 60; // 15 min

export async function blacklistToken(token: string): Promise<void> {
  await redis.set(`${BLACKLIST_PREFIX}${token}`, '1', ACCESS_TTL);
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  const exists = await redis.exists(`${BLACKLIST_PREFIX}${token}`);
  return exists === 1;
}

export async function authenticateWithBlacklist(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  authenticate(req, res, async () => {
    const token = req.headers.authorization!.slice(7);
    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted) {
      throw new UnauthorizedError('Token has been revoked');
    }
    next();
  });
}
