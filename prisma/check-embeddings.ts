import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { enqueueEmbed } from '../src/shared/utils/queue';
import { disconnectRedis } from '../src/config/redis';

dotenv.config({ override: true });

const prisma = new PrismaClient();

const rawArgs = process.argv.slice(2);
const args = {
  enqueue: rawArgs.includes('--enqueue'),
  limit: (() => {
    const limitArg = rawArgs.find((a) => a.startsWith('--limit='));
    if (!limitArg) return undefined;
    const parts = limitArg.split('=');
    const n = Number(parts[1]);
    return Number.isFinite(n) ? n : undefined;
  })(),
};

async function main() {
  console.log('Checking for chunks missing embeddings...');

  // Group missing embeddings by document
  const rows: Array<{ document_id: string; missing: string }> = await prisma.$queryRaw`
    SELECT c.document_id, COUNT(*)::text AS missing
    FROM chunks c
    WHERE c.embedding IS NULL
    GROUP BY c.document_id
    ORDER BY COUNT(*) DESC
    LIMIT ${args.limit ?? 1000}
  `;

  if (!rows || rows.length === 0) {
    console.log('No missing embeddings found.');
    return;
  }

  console.log(`Found ${rows.length} documents with missing embeddings:`);
  for (const r of rows) {
    console.log(`- ${r.document_id}: ${r.missing} chunks missing embeddings`);
  }

  if (!args.enqueue) {
    console.log('\nRun with `--enqueue` to create embed jobs for these documents.');
    return;
  }

  console.log('\nEnqueuing embed jobs...');
  for (const r of rows) {
    const docId = r.document_id;
    // fetch chunk ids missing embeddings for this document
    const chunkRows: Array<{ id: string }> = await prisma.$queryRaw`
      SELECT id FROM chunks WHERE document_id = ${docId}::uuid AND embedding IS NULL
      ORDER BY created_at ASC
    `;

    const chunkIds = chunkRows.map((c) => c.id);
    if (chunkIds.length === 0) continue;
    try {
      const jobId = await enqueueEmbed({ documentId: docId, chunkIds });
      console.log(`Enqueued embed job ${jobId} for document ${docId} (${chunkIds.length} chunks)`);
    } catch (err) {
      console.error(`Failed to enqueue embed for ${docId}:`, err);
    }
  }

  await disconnectRedis();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
