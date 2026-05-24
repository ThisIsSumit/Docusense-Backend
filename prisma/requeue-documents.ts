import dotenv from 'dotenv';
import { DocumentStatus, PrismaClient } from '@prisma/client';
import {
  embedQueue,
  enqueueIngest,
  ingestQueue,
} from '../src/shared/utils/queue';
import { disconnectRedis } from '../src/config/redis';

dotenv.config({ override: true });

const prisma = new PrismaClient();

const DEFAULT_STATUSES: DocumentStatus[] = [
  DocumentStatus.FAILED,
  DocumentStatus.PROCESSING,
];

type CliOptions = {
  dryRun?: boolean;
  statuses?: string;
  limit?: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--statuses') {
      options.statuses = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--limit') {
      options.limit = Number(argv[i + 1]);
      i += 1;
    }
  }

  return options;
}

function parseStatuses(raw?: string): DocumentStatus[] {
  if (!raw || !raw.trim()) return DEFAULT_STATUSES;

  const allowed = new Set(Object.values(DocumentStatus));
  const parsed = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is DocumentStatus => allowed.has(value as DocumentStatus));

  return parsed.length > 0 ? parsed : DEFAULT_STATUSES;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const statuses = parseStatuses(args.statuses ?? process.env.REQUEUE_STATUSES);
  const limit = Math.max(1, Number(args.limit ?? process.env.REQUEUE_LIMIT ?? 200));
  const dryRun = args.dryRun ?? (process.env.DRY_RUN ?? 'false').toLowerCase() === 'true';

  console.log('Requeue config:', {
    statuses,
    limit,
    dryRun,
  });

  const docs = await prisma.document.findMany({
    where: {
      status: {
        in: statuses,
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: limit,
    select: {
      id: true,
      userId: true,
      storageKey: true,
      mimeType: true,
      fileName: true,
      status: true,
    },
  });

  if (docs.length === 0) {
    console.log('No matching documents found.');
    return;
  }

  console.log(`Found ${docs.length} documents to requeue.`);

  if (dryRun) {
    docs.forEach((doc) => {
      console.log(`DRY_RUN -> ${doc.id} (${doc.status}) ${doc.fileName}`);
    });
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (const doc of docs) {
    try {
      await prisma.$transaction([
        prisma.document.update({
          where: { id: doc.id },
          data: {
            status: DocumentStatus.PENDING,
            processedAt: null,
          },
        }),
        prisma.chunk.deleteMany({ where: { documentId: doc.id } }),
      ]);

      const jobId = await enqueueIngest({
        documentId: doc.id,
        userId: doc.userId,
        storageKey: doc.storageKey,
        mimeType: doc.mimeType,
        fileName: doc.fileName,
      });

      successCount += 1;
      console.log(`Queued ${doc.id} -> job ${jobId}`);
    } catch (error) {
      failureCount += 1;
      console.error(`Failed to requeue ${doc.id}:`, error);
    }
  }

  console.log('Requeue complete:', {
    total: docs.length,
    successCount,
    failureCount,
  });
}

main()
  .catch((error) => {
    console.error('Bulk requeue failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await Promise.allSettled([ingestQueue.close(), embedQueue.close()]);
    await disconnectRedis();
  });
