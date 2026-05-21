import { Request, Response } from 'express';
import { z } from 'zod';
import { vectorSearch, rerankResults } from '../../shared/utils/embeddings.service';
import { generateAnswerStream, generateAnswer } from '../../shared/utils/ai.service';
import { prisma } from '../../config/database';
import { sendSuccess, sendError } from '../../shared/types/api.types';
import { logger } from '../../shared/utils/logger';

// ── Schemas ───────────────────────────────────────────────────────────────────

const searchSchema = z.object({
  q: z.string().min(1).max(500),
  documentId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(20).default(8),
  minSimilarity: z.coerce.number().min(0).max(1).default(0.3),
});

const querySchema = z.object({
  question: z.string().min(1).max(1000),
  documentId: z.string().uuid().optional(),
  stream: z.coerce.boolean().default(false),
});

// ── Controller ────────────────────────────────────────────────────────────────

export class SearchController {
  /** GET /search?q=... — semantic chunk search (no AI answer) */
  async search(req: Request, res: Response): Promise<void> {
    const { q, documentId, limit, minSimilarity } = searchSchema.parse(req.query);
    const userId = req.user!.sub;

    const raw = await vectorSearch(q, userId, { limit, documentId, minSimilarity });
    const results = rerankResults(raw, q);

    sendSuccess(res, {
      query: q,
      results,
      total: results.length,
    });
  }

  /** POST /search/query — RAG answer, optionally streamed via SSE */
  async query(req: Request, res: Response): Promise<void> {
    const { question, documentId, stream } = querySchema.parse(req.body);
    const userId = req.user!.sub;
    const startMs = Date.now();

    logger.debug(
      {
        userId,
        documentId,
        stream,
        questionPreview: question.slice(0, 200),
      },
      'Received search query request',
    );

    // Retrieve chunks
    const raw = await vectorSearch(question, userId, {
      limit: 8,
      documentId,
      minSimilarity: 0.25,
    });

    logger.debug(
      {
        userId,
        documentId,
        rawCount: raw.length,
      },
      'Vector search completed',
    );

    if (raw.length === 0) {
      const handled = await this._tryDocumentFallback({
        userId,
        question,
        documentId,
        stream,
        res,
        startMs,
      });

      if (handled) {
        return;
      }

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'No relevant content found' })}\n\n`);
        res.end();
        return;
      }
      sendError(res, 'No relevant content found for this question', 404, 'NO_CONTEXT');
      return;
    }

    const chunks = rerankResults(raw, question);

    // Resolve document title for scoped queries
    let documentTitle: string | undefined;
    if (documentId) {
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
        select: { title: true },
      });
      documentTitle = doc?.title;
    }

    if (stream) {
      // SSE streaming path
      const answer = await generateAnswerStream(
        question,
        chunks.map((c) => ({
          chunkId: c.chunkId,
          content: c.content,
          documentId: c.documentId,
          documentTitle: c.documentTitle,
          pageNumber: c.pageNumber,
          similarity: c.similarity,
        })),
        res,
        documentTitle,
      );

      // Persist query async (don't block SSE)
      void this._persistQuery(userId, question, answer, documentId, chunks, startMs);
      return;
    }

    // Non-streaming path
    const { answer, tokensUsed } = await generateAnswer(
      question,
      chunks.map((c) => ({
        chunkId: c.chunkId,
        content: c.content,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        pageNumber: c.pageNumber,
        similarity: c.similarity,
      })),
      documentTitle,
    );

    const latencyMs = Date.now() - startMs;
    await this._persistQuery(userId, question, answer, documentId, chunks, startMs);

    sendSuccess(res, {
      question,
      answer,
      sources: chunks.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        pageNumber: c.pageNumber,
        similarity: c.similarity,
        excerpt: c.content.slice(0, 200) + (c.content.length > 200 ? '...' : ''),
      })),
      meta: {
        tokensUsed,
        latencyMs,
        chunksSearched: chunks.length,
      },
    });
  }

  /** GET /search/history — user query history */
  async history(req: Request, res: Response): Promise<void> {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);

    const [items, total] = await Promise.all([
      prisma.query.findMany({
        where: { userId: req.user!.sub },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
        select: {
          id: true,
          question: true,
          answer: true,
          tokensUsed: true,
          latencyMs: true,
          createdAt: true,
          document: { select: { id: true, title: true } },
        },
      }),
      prisma.query.count({ where: { userId: req.user!.sub } }),
    ]);

    sendSuccess(res, { items, total, page, limit, hasMore: page * limit < total });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _persistQuery(
    userId: string,
    question: string,
    answer: string,
    documentId: string | undefined,
    chunks: any[],
    startMs: number,
  ) {
    try {
      await prisma.query.create({
        data: {
          userId,
          documentId: documentId ?? null,
          question,
          answer,
          sourceChunks: chunks.map((c) => ({
            chunkId: c.chunkId,
            documentId: c.documentId,
            similarity: c.similarity,
          })),
          tokensUsed: answer.length, // approximate
          latencyMs: Date.now() - startMs,
        },
      });

      // Increment user query count
      await prisma.user.update({
        where: { id: userId },
        data: { queriesCount: { increment: 1 } },
      });

      // Increment doc query count if scoped
      if (documentId) {
        await prisma.document.update({
          where: { id: documentId },
          data: { queryCount: { increment: 1 } },
        });
      }
    } catch (err) {
      logger.error({ err }, 'Failed to persist query');
    }
  }

  private async _tryDocumentFallback(params: {
    userId: string;
    question: string;
    documentId?: string;
    stream: boolean;
    res: Response;
    startMs: number;
  }): Promise<boolean> {
    const { userId, question, documentId, stream, res, startMs } = params;

    if (!documentId) {
      return false;
    }

    const doc = await prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { id: true, title: true },
    });

    if (!doc) {
      return false;
    }

    const directChunks = await prisma.chunk.findMany({
      where: { documentId: doc.id },
      orderBy: { chunkIndex: 'asc' },
      select: {
        id: true,
        documentId: true,
        content: true,
        pageNumber: true,
        chunkIndex: true,
      },
      take: 8,
    });

    if (directChunks.length === 0) {
      return false;
    }

    logger.debug(
      {
        userId,
        documentId,
        directChunkCount: directChunks.length,
      },
      'Using direct document chunks as fallback context',
    );

    const chunks = rerankResults(
      directChunks.map((c) => ({
        chunkId: c.id,
        documentId: c.documentId,
        documentTitle: doc.title,
        userId,
        content: c.content,
        pageNumber: c.pageNumber,
        similarity: 1,
      })),
      question,
    );

    const aiChunks = chunks.map((c) => ({
      chunkId: c.chunkId,
      content: c.content,
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      pageNumber: c.pageNumber,
      similarity: c.similarity,
    }));

    if (stream) {
      const answer = await generateAnswerStream(question, aiChunks, res, doc.title);
      void this._persistQuery(userId, question, answer, documentId, chunks, startMs);
      return true;
    }

    const { answer, tokensUsed } = await generateAnswer(question, aiChunks, doc.title);
    const latencyMs = Date.now() - startMs;
    await this._persistQuery(userId, question, answer, documentId, chunks, startMs);

    sendSuccess(res, {
      question,
      answer,
      sources: chunks.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        pageNumber: c.pageNumber,
        similarity: c.similarity,
        excerpt: c.content.slice(0, 200) + (c.content.length > 200 ? '...' : ''),
      })),
      meta: {
        tokensUsed,
        latencyMs,
        chunksSearched: chunks.length,
        retrievalMode: 'direct-document-fallback',
      },
    });

    return true;
  }
}

export const searchController = new SearchController();
