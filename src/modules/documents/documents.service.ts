import { prisma } from '../../config/database';
import { storageService } from '../../shared/utils/storage.service';
import { enqueueIngest } from '../../shared/utils/queue';
import { NotFoundError, ForbiddenError, buildPaginatedResult, paginate } from '../../shared/types/api.types';
import { logger } from '../../shared/utils/logger';

const SUPPORTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

type DocumentStatusResponse = 'pending' | 'processing' | 'ready' | 'failed';

type DocumentResponse = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  status: DocumentStatusResponse;
  summary: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  pageCount: number;
  queryCount: number;
  createdAt: Date;
  processedAt: Date | null;
};

function mapDocumentResponse(document: {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  status: string;
  summary: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  pageCount: number;
  queryCount: number;
  createdAt: Date;
  processedAt: Date | null;
}): DocumentResponse {
  return {
    id: document.id,
    title: document.title,
    fileName: document.fileName,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    status: document.status.toLowerCase() as DocumentStatusResponse,
    summary: document.summary,
    thumbnailUrl: document.thumbnailUrl,
    tags: document.tags,
    pageCount: document.pageCount,
    queryCount: document.queryCount,
    createdAt: document.createdAt,
    processedAt: document.processedAt,
  };
}

export class DocumentsService {
  async uploadDocument(
    userId: string,
    file: Express.Multer.File,
  ) {
    // Validate
    if (!SUPPORTED_TYPES.includes(file.mimetype)) {
      throw new Error(`Unsupported file type: ${file.mimetype}`);
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new Error('File exceeds 50 MB limit');
    }

    // Store file
    const stored = await storageService.save(file, `users/${userId}/documents`);

    // Create DB record
    const document = await prisma.document.create({
      data: {
        userId,
        title: file.originalname.replace(/\.[^.]+$/, ''),
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        storageKey: stored.key,
        status: 'PENDING',
      },
    });

    // Increment user document count
    await prisma.user.update({
      where: { id: userId },
      data: { documentsCount: { increment: 1 } },
    });

    // Enqueue ingestion job
    const jobId = await enqueueIngest({
      documentId: document.id,
      userId,
      storageKey: stored.key,
      mimeType: file.mimetype,
      fileName: file.originalname,
    });

    logger.info({ documentId: document.id, userId, jobId }, 'Document uploaded');

    return {
      document: mapDocumentResponse(document),
      jobId,
      job_id: jobId,
    };
  }

  async listDocuments(
    userId: string,
    opts: {
      page?: number;
      limit?: number;
      status?: string;
      search?: string;
      tag?: string;
    } = {},
  ) {
    const { page = 1, limit = 20, status, search, tag } = opts;
    const { take, skip } = paginate(page, limit);

    logger.info({ userId, page, limit, status, search, tag }, 'Listing documents');

    const where = {
      userId,
      ...(status && { status: status as any }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' as const } },
          { summary: { contains: search, mode: 'insensitive' as const } },
          { fileName: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(tag && { tags: { has: tag } }),
    };

    logger.info({ where }, 'Query filter');

    const [items, total] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          title: true,
          fileName: true,
          mimeType: true,
          fileSizeBytes: true,
          status: true,
          summary: true,
          thumbnailUrl: true,
          tags: true,
          pageCount: true,
          queryCount: true,
          createdAt: true,
          processedAt: true,
        },
      }),
      prisma.document.count({ where }),
    ]);

    logger.info({ itemsCount: items.length, total }, 'Documents listed');

    return {
      items: items.map(mapDocumentResponse),
      total,
      hasMore: page * limit < total,
    };
  }

  async getDocument(documentId: string, userId: string) {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        _count: { select: { chunks: true } },
      },
    });

    if (!doc) throw new NotFoundError('Document');
    if (doc.userId !== userId) throw new ForbiddenError();

    return {
      ...mapDocumentResponse(doc),
      chunkCount: doc._count.chunks,
    };
  }

  async deleteDocument(documentId: string, userId: string): Promise<void> {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundError('Document');
    if (doc.userId !== userId) throw new ForbiddenError();

    // Delete storage file
    await storageService.delete(doc.storageKey).catch(() => {
      logger.warn({ documentId }, 'Storage delete failed (file may not exist)');
    });

    // Cascade deletes chunks + queries via Prisma schema
    await prisma.document.delete({ where: { id: documentId } });

    // Decrement user count
    await prisma.user.update({
      where: { id: userId },
      data: { documentsCount: { decrement: 1 } },
    });

    logger.info({ documentId, userId }, 'Document deleted');
  }

  async updateDocument(
    documentId: string,
    userId: string,
    data: { title?: string; tags?: string[] },
  ) {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundError('Document');
    if (doc.userId !== userId) throw new ForbiddenError();

    const updated = await prisma.document.update({
      where: { id: documentId },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.tags && { tags: data.tags }),
      },
    });

    return mapDocumentResponse(updated);
  }

  async getJobStatus(jobId: string) {
    const { getJobStatus } = await import('../../shared/utils/queue');
    return getJobStatus(jobId);
  }

  async getDocumentChunks(documentId: string, userId: string) {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundError('Document');
    if (doc.userId !== userId) throw new ForbiddenError();

    return prisma.chunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
      select: {
        id: true,
        content: true,
        pageNumber: true,
        chunkIndex: true,
      },
    });
  }

  async reprocessDocument(documentId: string, userId: string): Promise<string> {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundError('Document');
    if (doc.userId !== userId) throw new ForbiddenError();

    // Reset status and delete old chunks
    await prisma.$transaction([
      prisma.document.update({
        where: { id: documentId },
        data: { status: 'PENDING', processedAt: null },
      }),
      prisma.chunk.deleteMany({ where: { documentId } }),
    ]);

    // Re-enqueue ingestion
    const jobId = await enqueueIngest({
      documentId: doc.id,
      userId,
      storageKey: doc.storageKey,
      mimeType: doc.mimeType,
      fileName: doc.fileName,
    });

    logger.info({ documentId, jobId }, 'Document reprocess enqueued');
    return jobId;
  }



  // async reprocessDocument(documentId: string, userId: string): Promise<string> {
  //   const doc = await prisma.document.findUnique({ where: { id: documentId } });
  //   if (!doc) throw new NotFoundError('Document');
  //   if (doc.userId !== userId) throw new ForbiddenError();

  //   // Reset status and delete old chunks
  //   await prisma.$transaction([
  //     prisma.document.update({
  //       where: { id: documentId },
  //       data: { status: 'PENDING', processedAt: null },
  //     }),
  //     prisma.chunk.deleteMany({ where: { documentId } }),
  //   ]);

  //   // Re-enqueue ingestion
  //   const jobId = await enqueueIngest({
  //     documentId: doc.id,
  //     userId,
  //     storageKey: doc.storageKey,
  //     mimeType: doc.mimeType,
  //     fileName: doc.fileName,
  //   });

  //   logger.info({ documentId, jobId }, 'Document reprocess enqueued');
  //   return jobId;
  // }
}

export const documentsService = new DocumentsService();
