import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/types/api.types';
import { logger } from '../shared/utils/logger';
import { config } from '../config/config';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // App errors (known)
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, req: { method: req.method, url: req.url } });
    }
    res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Zod validation
  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.flatten().fieldErrors,
      },
    });
    return;
  }

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        success: false,
        code: 'CONFLICT',
        message: 'Resource already exists',
        error: {
          code: 'CONFLICT',
          message: 'Resource already exists',
        },
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Resource not found',
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
      return;
    }
  }

  // Unknown errors
  logger.error({ err, req: { method: req.method, url: req.url } }, 'Unhandled error');

  res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      ...(config.NODE_ENV === 'development' && {
        details: err instanceof Error ? err.message : String(err),
      }),
    },
  });
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${req.url} not found`,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.url} not found`,
    },
  });
}
