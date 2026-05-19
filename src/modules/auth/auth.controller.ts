import { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from './auth.service';
import { sendSuccess, sendError } from '../../shared/types/api.types';

// ── Schemas ───────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

// ── Controller ────────────────────────────────────────────────────────────────

export class AuthController {
  async register(req: Request, res: Response): Promise<void> {
    const dto = registerSchema.parse(req.body);
    const result = await authService.register(dto);
    sendSuccess(res, result, 201);
  }

  async login(req: Request, res: Response): Promise<void> {
    const dto = loginSchema.parse(req.body);
    const result = await authService.login({
      ...dto,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    sendSuccess(res, result);
  }

  async refresh(req: Request, res: Response): Promise<void> {
    const { refreshToken } = refreshSchema.parse(req.body);
    const result = await authService.refreshTokens(refreshToken);
    sendSuccess(res, result);
  }

  async logout(req: Request, res: Response): Promise<void> {
    const accessToken = req.headers.authorization!.slice(7);
    const refreshToken = req.body?.refreshToken as string | undefined;
    await authService.logout(accessToken, refreshToken);
    sendSuccess(res, { message: 'Logged out successfully' });
  }

  async logoutAll(req: Request, res: Response): Promise<void> {
    const accessToken = req.headers.authorization!.slice(7);
    await authService.logoutAll(req.user!.sub, accessToken);
    sendSuccess(res, { message: 'All sessions terminated' });
  }

  async me(req: Request, res: Response): Promise<void> {
    const user = await authService.getProfile(req.user!.sub);
    sendSuccess(res, user);
  }

  async changePassword(req: Request, res: Response): Promise<void> {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await authService.changePassword(req.user!.sub, currentPassword, newPassword);
    sendSuccess(res, { message: 'Password updated successfully' });
  }
}

export const authController = new AuthController();
