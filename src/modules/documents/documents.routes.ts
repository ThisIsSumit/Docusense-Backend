import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { uploadLimiter } from '../../middleware/rate-limit.middleware';
import {
  documentsController,
  uploadMiddleware,
} from './documents.controller';

const router = Router();

// All document routes require auth
router.use(authenticate);

// ── IMPORTANT: Specific paths MUST come before /:id wildcard ─────────────────
// Otherwise Express matches /jobs/xxx and /xxx/reprocess against /:id first.

// Static paths first
router.post(
  '/',
  uploadLimiter,
  uploadMiddleware.single('file'),
  (req, res) => documentsController.upload(req, res),
);

router.get('/', (req, res) => documentsController.list(req, res));

// Specific sub-paths before /:id
router.get('/jobs/:jobId/status', (req, res) => documentsController.getJobStatus(req, res));

// Dynamic /:id routes
router.get('/:id/download', (req, res) => documentsController.download(req, res));
router.get('/:id', (req, res) => documentsController.getById(req, res));
router.patch('/:id', (req, res) => documentsController.update(req, res));
router.delete('/:id', (req, res) => documentsController.delete(req, res));
router.get('/:id/chunks', (req, res) => documentsController.getChunks(req, res));
router.post('/:id/reprocess', (req, res) => documentsController.reprocess(req, res));

export { router as documentsRouter };
