import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
import { sendSuccess, NotFoundError } from '../../shared/types/api.types';

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

const router = Router();
router.use(authenticate);

// GET /users/me/stats
router.get('/me/stats', async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  const [user, recentQueries, docsByStatus, totalDocs, totalQueries] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        createdAt: true,
      },
    }),
    prisma.query.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        question: true,
        createdAt: true,
        document: { select: { id: true, title: true } },
      },
    }),
    prisma.document.groupBy({
      by: ['status'],
      where: { userId },
      _count: { status: true },
    }),
    prisma.document.count({ where: { userId } }),
    prisma.query.count({ where: { userId } }),
  ]);

  if (!user) throw new NotFoundError('User');

  const statusMap = Object.fromEntries(
    docsByStatus.map((d) => [d.status, d._count.status]),
  );

  sendSuccess(res, {
    documentsCount: totalDocs,
    queriesCount: totalQueries,
    memberSince: user.createdAt,
    documentsByStatus: {
      PENDING: statusMap['PENDING'] ?? 0,
      PROCESSING: statusMap['PROCESSING'] ?? 0,
      READY: statusMap['READY'] ?? 0,
      FAILED: statusMap['FAILED'] ?? 0,
    },
    recentQueries,
  });
});

// PATCH /users/me
router.patch('/me', async (req: Request, res: Response) => {
  const data = updateProfileSchema.parse(req.body);
  const updated = await prisma.user.update({
    where: { id: req.user!.sub },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      updatedAt: true,
    },
  });
  sendSuccess(res, updated);
});

// DELETE /users/me
router.delete('/me', async (req: Request, res: Response) => {
  await prisma.user.delete({ where: { id: req.user!.sub } });
  sendSuccess(res, { message: 'Account deleted' });
});

export { router as usersRouter };
