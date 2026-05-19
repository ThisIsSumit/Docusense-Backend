import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate, authenticateWithBlacklist } from '../../middleware/auth.middleware';
import { authLimiter } from '../../middleware/rate-limit.middleware';

const router = Router();

// Public
router.post('/register', authLimiter, (req, res) => authController.register(req, res));
router.post('/login', authLimiter, (req, res) => authController.login(req, res));
router.post('/refresh', (req, res) => authController.refresh(req, res));

// Protected
router.post('/logout', authenticate, (req, res) => authController.logout(req, res));
router.post('/logout-all', authenticate, (req, res) => authController.logoutAll(req, res));
router.get('/me', authenticate, (req, res) => authController.me(req, res));
router.put('/change-password', authenticate, (req, res) => authController.changePassword(req, res));

export { router as authRouter };
