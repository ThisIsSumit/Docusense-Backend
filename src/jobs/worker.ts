import 'express-async-errors';
import { Worker, Job } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { parsePdf } from '../shared/utils/pdf-parse-wrapper';
import { getRedis } from '../config/redis';
import { connectDB, disconnectDB, prisma } from '../config/database';
import { config } from '../config/config';
import { logger } from '../shared/utils/logger';
import {
  QUEUE_NAMES,
  IngestJobData,
  EmbedJobData,
  enqueueEmbed,
} from '../shared/utils/queue';
import {
  extractDocumentStructure,
  chunkText,
} from '../shared/utils/ai.service';
import { embedAndStoreChunks } from '../shared/utils/embeddings.service';

// ── Text extraction helpers ───────────────────────────────────────────────────

async function extractText(
  storageKey: string,
  mimeType: string,
): Promise<string> {
  const filePath = path.join(
    path.resolve(config.STORAGE_LOCAL_PATH),
    storageKey,
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at ${filePath}`);
  }

  logger.debug({ storageKey, mimeType, filePath }, 'Extracting document text');
  const buffer = fs.readFileSync(filePath);

  if (mimeType === 'text/plain') {
    const text = buffer.toString('utf-8');
    logger.debug({ storageKey, textLength: text.length }, 'Plain text extracted');
    return text;
  }

  if (mimeType === 'application/pdf') {
    try {
      const parsed = await parsePdf(buffer);
      logger.debug(
        {
          storageKey,
          pages: parsed?.numpages,
          textLength: parsed?.text?.length ?? 0,
        },
        'PDF text extracted',
      );
      return parsed?.text ?? '';
    } catch (err: any) {
      logger.error(
        {
          storageKey,
          errMessage: err?.message,
          moduleShape: err?.moduleShape ?? undefined,
          stack: err?.stack,
        },
        'PDF parse failed with module-shape diagnostic',
      );
      throw err;
    }
  }

  const fallback = `[Binary file: ${mimeType}, size: ${buffer.length} bytes, key: ${storageKey}]`;
  logger.debug({ storageKey, mimeType, fallbackLength: fallback.length }, 'Using binary placeholder text');
  return fallback;
}

// ── Ingest Worker ─────────────────────────────────────────────────────────────

async function processIngestJob(job: Job<IngestJobData>): Promise<void> {
  const { documentId, userId, storageKey, mimeType, fileName } = job.data;

  logger.info({ documentId, jobId: job.id }, 'Starting ingest job');

  // Mark as PROCESSING
  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'PROCESSING' },
  });

  await job.updateProgress(10);

  try {
    // 1. Extract raw text
    const rawText = await extractText(storageKey, mimeType);
    logger.debug(
      {
        documentId,
        storageKey,
        mimeType,
        rawTextLength: rawText.length,
        rawTextPreview: rawText.slice(0, 500),
      },
      'Raw text extracted',
    );
    await job.updateProgress(25);

    // 2. AI extraction (Claude tool use)
    logger.debug(
      {
        documentId,
        fileName,
        promptTextLength: Math.min(rawText.length, 80000),
      },
      'Sending document to AI extraction',
    );
    const extracted = await extractDocumentStructure(rawText, fileName);
    logger.debug(
      {
        documentId,
        title: extracted.title,
        pageCount: extracted.pageCount,
        tags: extracted.tags,
        documentType: extracted.documentType,
      },
      'AI extraction completed',
    );
    await job.updateProgress(50);

    // 3. Chunk text for embeddings
    const textChunks = chunkText(rawText, 1000, 200);

    // 4. Create chunk records in DB (without embeddings yet)
    const chunkRecords: { id: string }[] = [];
    for (let idx = 0; idx < textChunks.length; idx += 1) {
      const content = textChunks[idx];
      const record = await prisma.chunk.create({
        data: {
          documentId,
          content,
          chunkIndex: idx,
          pageNumber: null, // would be set for PDFs
        },
      });
      chunkRecords.push({ id: record.id });
    }

    await job.updateProgress(70);

    // 5. Update document with extracted metadata
    await prisma.document.update({
      where: { id: documentId },
      data: {
        title: extracted.title,
        summary: extracted.summary,
        tags: extracted.tags,
        pageCount: extracted.pageCount,
        metadata: {
          keyEntities: extracted.keyEntities,
          keyDates: extracted.keyDates,
          language: extracted.language,
          documentType: extracted.documentType,
        },
      },
    });

    await job.updateProgress(80);

    // 6. Enqueue embed job
    await enqueueEmbed({
      documentId,
      chunkIds: chunkRecords.map((c) => c.id),
    });

    await job.updateProgress(90);

    logger.info(
      { documentId, chunks: chunkRecords.length },
      'Ingest complete, embed job queued',
    );
  } catch (err) {
    logger.error({ err, documentId }, 'Ingest job failed');

    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED' },
    });

    throw err; // BullMQ will retry
  }
}

// ── Embed Worker ──────────────────────────────────────────────────────────────

async function processEmbedJob(job: Job<EmbedJobData>): Promise<void> {
  const { documentId, chunkIds } = job.data;

  logger.info(
    { documentId, chunkCount: chunkIds.length, jobId: job.id },
    'Starting embed job',
  );

  try {
    // Fetch chunk contents
    const chunks = await prisma.chunk.findMany({
      where: { id: { in: chunkIds } },
      select: { id: true, content: true },
    });

    await job.updateProgress(20);

    // Generate + store embeddings
    await embedAndStoreChunks(documentId, chunks);

    await job.updateProgress(90);

    // Mark document READY
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'READY',
        processedAt: new Date(),
      },
    });

    // Increment user doc count
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { userId: true },
    });
    if (doc) {
      await prisma.user.update({
        where: { id: doc.userId },
        data: { documentsCount: { increment: 1 } },
      });
    }

    await job.updateProgress(100);
    logger.info({ documentId }, 'Embed complete — document READY');
  } catch (err) {
    logger.error({ err, documentId }, 'Embed job failed');
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED' },
    });
    throw err;
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function main() {
  await connectDB();
  logger.info('Worker connected to database');

  const connection = { connection: getRedis() };
  const concurrency = Math.max(1, Math.min(config.QUEUE_CONCURRENCY, 1));

  const ingestWorker = new Worker<IngestJobData>(
    QUEUE_NAMES.INGEST,
    processIngestJob,
    { ...connection, concurrency },
  );

  const embedWorker = new Worker<EmbedJobData>(
    QUEUE_NAMES.EMBED,
    processEmbedJob,
    { ...connection, concurrency },
  );

  // Events
  for (const worker of [ingestWorker, embedWorker]) {
    worker.on('completed', (job) =>
      logger.info({ jobId: job.id, queue: job.queueName }, 'Job completed'),
    );
    worker.on('failed', (job, err) =>
      logger.error({ jobId: job?.id, queue: job?.queueName, err }, 'Job failed'),
    );
    worker.on('error', (err) => logger.error({ err }, 'Worker error'));
  }

  logger.info(
    { concurrency, queues: Object.values(QUEUE_NAMES) },
    '🚀 Worker started',
  );

  // Graceful shutdown
  async function shutdown() {
    logger.info('Shutting down workers...');
    await Promise.all([ingestWorker.close(), embedWorker.close()]);
    await disconnectDB();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Worker bootstrap failed');
  process.exit(1);
});
