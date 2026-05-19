import { Queue, QueueEvents, Worker, Job } from 'bullmq';
import { getRedis } from '../../config/redis';
import { logger } from '../utils/logger';
import { config } from '../../config/config';

// ── Job Types ─────────────────────────────────────────────────────────────────

export interface IngestJobData {
  documentId: string;
  userId: string;
  storageKey: string;
  mimeType: string;
  fileName: string;
}

export interface EmbedJobData {
  documentId: string;
  chunkIds: string[];
}

// ── Queue Names ───────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  INGEST: 'document_ingest',
  EMBED: 'document_embed',
} as const;

// ── Queue Instances ───────────────────────────────────────────────────────────

const connection = { connection: getRedis() };

export const ingestQueue = new Queue<IngestJobData>(QUEUE_NAMES.INGEST, {
  ...connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

export const embedQueue = new Queue<EmbedJobData>(QUEUE_NAMES.EMBED, {
  ...connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

// ── Job helpers ───────────────────────────────────────────────────────────────

export async function enqueueIngest(data: IngestJobData): Promise<string> {
  const job = await ingestQueue.add('ingest', data, {
    priority: 10,
  });
  logger.info({ jobId: job.id, documentId: data.documentId }, 'Ingest job enqueued');
  return job.id!;
}

export async function enqueueEmbed(data: EmbedJobData): Promise<string> {
  const job = await embedQueue.add('embed', data);
  logger.info({ jobId: job.id, documentId: data.documentId }, 'Embed job enqueued');
  return job.id!;
}

export async function getJobStatus(jobId: string) {
  const job = await ingestQueue.getJob(jobId);
  if (!job) return null;
  const state = await job.getState();

  const normalizedState =
    state === 'completed' || state === 'failed' || state === 'active'
      ? state
      : 'waiting';

  return {
    id: job.id,
    state: normalizedState,
    progress: typeof job.progress === 'number' ? job.progress : Number(job.progress) || 0,
    failedReason: job.failedReason ?? null,
  };
}

export async function waitForJobCompletion(jobId: string, timeoutMs = 30000, pollInterval = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getJobStatus(jobId);
    if (!status) return null;
    if (status.state === 'completed' || status.state === 'failed') return status;
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  return { id: jobId, state: 'waiting', progress: 0, failedReason: 'timeout' };
}
