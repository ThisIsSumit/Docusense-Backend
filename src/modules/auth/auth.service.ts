import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { config } from '../../config/config';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  blacklistToken,
} from '../../middleware/auth.middleware';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  AppError,
} from '../../shared/types/api.types';
import { logger } from '../../shared/utils/logger';

const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const SESSION_PREFIX = 'sess:';

export interface RegisterDto {
  name: string;
  email: string;
  password: string;
}

export interface LoginDto {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    documentsCount: number;
    queriesCount: number;
    createdAt: Date;
    lastLoginAt: Date | null;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
  expiresIn: number;
}

export class AuthService {
  async register(dto: RegisterDto): Promise<AuthResult> {
    // Check existing
    const existing = await prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictError('An account with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name.trim(),
        passwordHash,
      },
    });

    logger.info({ userId: user.id }, 'User registered');

    // Generate tokens + session
    const { accessToken, refreshToken } = await this._createSession(user.id, user.email, {});

    return {
      user: this._formatUser(user),
      tokens: {
        accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
      expiresIn: 900,
    };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) throw new UnauthorizedError('Invalid email or password');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedError('Invalid email or password');

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { accessToken, refreshToken } = await this._createSession(
      user.id,
      user.email,
      { userAgent: dto.userAgent, ipAddress: dto.ipAddress },
    );

    logger.info({ userId: user.id }, 'User logged in');

    return {
      user: this._formatUser({ ...user, lastLoginAt: new Date() }),
      tokens: {
        accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
      expiresIn: 900,
    };
  }

  async refreshTokens(token: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const payload = verifyRefreshToken(token);

    // Check session exists in DB
    const session = await prisma.session.findUnique({
      where: { refreshToken: token },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedError('Session expired, please log in again');
    }

    if (session.userId !== payload.sub) {
      throw new UnauthorizedError('Token mismatch');
    }

    // Rotate refresh token
    const newRefreshToken = generateRefreshToken(session.userId, session.user.email);
    const newAccessToken = generateAccessToken(session.userId, session.user.email);

    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

    await prisma.session.update({
      where: { id: session.id },
      data: { refreshToken: newRefreshToken, expiresAt },
    });

    // Blacklist old refresh token in Redis
    await redis.set(
      `${SESSION_PREFIX}revoked:${token}`,
      '1',
      REFRESH_TOKEN_TTL,
    );

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900,
    };
  }

  async logout(accessToken: string, refreshToken?: string): Promise<void> {
    // Blacklist access token
    await blacklistToken(accessToken);

    // Delete session
    if (refreshToken) {
      await prisma.session.deleteMany({ where: { refreshToken } });
    }
  }

  async logoutAll(userId: string, currentAccessToken: string): Promise<void> {
    await blacklistToken(currentAccessToken);
    await prisma.session.deleteMany({ where: { userId } });
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');
    return this._formatUser(user);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError('Current password is incorrect', 400, 'INVALID_PASSWORD');

    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Invalidate all sessions except current
    await prisma.session.deleteMany({ where: { userId } });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _createSession(
    userId: string,
    email: string,
    meta: { userAgent?: string; ipAddress?: string },
  ) {
    const accessToken = generateAccessToken(userId, email);
    const refreshToken = generateRefreshToken(userId, email);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

    await prisma.session.create({
      data: {
        userId,
        refreshToken,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private _formatUser(user: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    documentsCount: number;
    queriesCount: number;
    createdAt: Date;
    lastLoginAt?: Date | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      documentsCount: user.documentsCount,
      queriesCount: user.queriesCount,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt ?? null,
    };
  }
}

export const authService = new AuthService();
