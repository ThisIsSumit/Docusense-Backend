import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { logger } from '../shared/utils/logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      config.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (config.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function connectDB(): Promise<void> {
  await prisma.$connect();

  // Enable pgvector extension
  await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS vector`;
  await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

  const [{ chunksTable }] = await prisma.$queryRaw<Array<{ chunksTable: string | null }>>`
    SELECT to_regclass('public.chunks')::text AS "chunksTable"
  `;

  if (!chunksTable) {
    logger.warn(
      'Skipping pgvector index setup because the chunks table does not exist yet. Run Prisma migrations first.',
    );
    return;
  }

  // Create HNSW index on chunks.embedding if not exists
  await prisma.$executeRaw`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'chunks'
        AND indexname = 'chunks_embedding_hnsw_idx'
      ) THEN
        CREATE INDEX chunks_embedding_hnsw_idx
        ON chunks USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
      END IF;
    END $$
  `;
}

export async function disconnectDB(): Promise<void> {
  await prisma.$disconnect();
}
