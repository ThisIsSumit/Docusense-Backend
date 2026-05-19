import { Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/config';
import { documentsService } from './documents.service';
import { sendSuccess, sendError, AppError } from '../../shared/types/api.types';
import { logger } from '../../shared/utils/logger';

// ── Multer config (disk storage) ─────────────────────────────────────────────
export const uploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const userId = req.user?.sub;
      if (!userId) {
        cb(new AppError('Unauthorized', 401, 'UNAUTHORIZED'), '');
        return;
      }

      const finalDir = path.resolve(
        config.STORAGE_LOCAL_PATH,
        `users/${userId}/documents`,
      );
      fs.mkdirSync(finalDir, { recursive: true });
      cb(null, finalDir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(`Unsupported file type: ${file.mimetype}`, 415, 'UNSUPPORTED_MEDIA_TYPE'));
    }
  },
});

// ── Schemas ───────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']).optional(),
  search: z.string().optional(),
  tag: z.string().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  tags: z.array(z.string()).max(10).optional(),
});

function logDocumentResponse(action: string, payload: unknown): void {
  logger.debug(
    { action, payload },
    'Documents response payload',
  );
}

// ── Controller ────────────────────────────────────────────────────────────────

export class DocumentsController {
  async upload(req: Request, res: Response): Promise<void> {
    logger.debug(
      {
        action: 'documents.upload.request',
        userId: req.user?.sub,
        file: req.file
          ? {
              originalname: req.file.originalname,
              mimetype: req.file.mimetype,
              size: req.file.size,
            }
          : null,
      },
      'Documents request received',
    );

    if (!req.file) {
      sendError(res, 'No file provided', 400, 'NO_FILE');
      return;
    }
    const result = await documentsService.uploadDocument(req.user!.sub, req.file);
    // If client requested to wait for processing, poll job status and return final document
    const wait = String(req.query.wait || '').toLowerCase() === 'true';
    if (wait) {
      const { waitForJobCompletion } = await import('../../shared/utils/queue');
      const status = await waitForJobCompletion(result.jobId, 30000, 1000);
      if (!status) {
        logDocumentResponse('documents.upload.response', result);
        sendSuccess(res, result, 201);
        return;
      }

      if (status.state === 'failed') {
        sendError(res, 'Document processing failed', 500, 'PROCESSING_FAILED');
        return;
      }

      // Fetch latest document record
      const doc = await documentsService.getDocument(result.document.id, req.user!.sub);
      logDocumentResponse('documents.upload.response', { document: doc, jobId: result.jobId });
      sendSuccess(res, { document: doc, jobId: result.jobId }, 201);
      return;
    }

    logDocumentResponse('documents.upload.response', result);
    sendSuccess(res, result, 201);
  }

  async list(req: Request, res: Response): Promise<void> {
    const query = listQuerySchema.parse(req.query);
    logger.debug(
      {
        action: 'documents.list.request',
        userId: req.user?.sub,
        query,
      },
      'Documents request received',
    );

    const result = await documentsService.listDocuments(req.user!.sub, query);
    logDocumentResponse('documents.list.response', result);
    sendSuccess(res, result);
  }

  async getById(req: Request, res: Response): Promise<void> {
    logger.debug(
      {
        action: 'documents.getById.request',
        userId: req.user?.sub,
        documentId: req.params.id,
      },
      'Documents request received',
    );

    const doc = await documentsService.getDocument(req.params.id, req.user!.sub);
    logDocumentResponse('documents.getById.response', doc);
    sendSuccess(res, doc);
  }

  async update(req: Request, res: Response): Promise<void> {
    const data = updateSchema.parse(req.body);
    logger.debug(
      {
        action: 'documents.update.request',
        userId: req.user?.sub,
        documentId: req.params.id,
        data,
      },
      'Documents request received',
    );

    const doc = await documentsService.updateDocument(req.params.id, req.user!.sub, data);
    logDocumentResponse('documents.update.response', doc);
    sendSuccess(res, doc);
  }

  async delete(req: Request, res: Response): Promise<void> {
    logger.debug(
      {
        action: 'documents.delete.request',
        userId: req.user?.sub,
        documentId: req.params.id,
      },
      'Documents request received',
    );

    await documentsService.deleteDocument(req.params.id, req.user!.sub);
    logger.debug(
      {
        action: 'documents.delete.response',
        documentId: req.params.id,
      },
      'Documents response payload',
    );
    sendSuccess(res, { message: 'Document deleted' });
  }

  async getJobStatus(req: Request, res: Response): Promise<void> {
    logger.debug(
      {
        action: 'documents.getJobStatus.request',
        userId: req.user?.sub,
        jobId: req.params.jobId,
      },
      'Documents request received',
    );

    const status = await documentsService.getJobStatus(req.params.jobId);
    if (!status) {
      sendError(res, 'Job not found', 404, 'NOT_FOUND');
      return;
    }
    logDocumentResponse('documents.getJobStatus.response', status);
    sendSuccess(res, status);
  }

  async getChunks(req: Request, res: Response): Promise<void> {
    logger.debug(
      {
        action: 'documents.getChunks.request',
        userId: req.user?.sub,
        documentId: req.params.id,
      },
      'Documents request received',
    );

    const chunks = await documentsService.getDocumentChunks(
      req.params.id,
      req.user!.sub,
    );
    logDocumentResponse('documents.getChunks.response', {
      documentId: req.params.id,
      chunksCount: chunks.length,
      chunks,
    });
    sendSuccess(res, chunks);
  }
  async reprocess(req: Request, res: Response): Promise<void> {
    logger.debug(
      {
        action: 'documents.reprocess.request',
        userId: req.user?.sub,
        documentId: req.params.id,
      },
      'Documents request received',
    );

    const jobId = await documentsService.reprocessDocument(req.params.id, req.user!.sub);
    logDocumentResponse('documents.reprocess.response', { jobId, documentId: req.params.id });
    sendSuccess(res, { jobId, documentId: req.params.id });
  }
}

export const documentsController = new DocumentsController();
