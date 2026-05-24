import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { storageService } from '../src/shared/utils/storage.service';

dotenv.config({ override: true });

const prisma = new PrismaClient();

type SeedDocument = {
  id: string;
  title: string;
  fileName: string;
  storageKey: string;
  mimeType: string;
  content: string;
  status: 'READY' | 'PROCESSING';
  summary?: string;
  tags?: string[];
  pageCount: number;
  queryCount: number;
};

async function uploadSeedDocument(folder: string, doc: SeedDocument) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docusense-seed-'));
  const tempPath = path.join(tempDir, doc.fileName);

  try {
    fs.writeFileSync(tempPath, doc.content, 'utf8');
    const stored = await storageService.save(
      {
        originalname: doc.fileName,
        mimetype: doc.mimeType,
        size: Buffer.byteLength(doc.content),
        path: tempPath,
      } as Express.Multer.File,
      folder,
      doc.storageKey,
      true,
    );

    return stored;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function ensureSchema() {
  try {
    await prisma.user.findFirst({ select: { id: true } });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('public.users')) {
      throw error;
    }
  }

  console.log('⚠️  Database schema missing; applying initial migration...');
  const migrationPath = path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260407152835_docusense_copy',
    'migration.sql',
  );
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    await client.query(migrationSql);
  } finally {
    await client.end();
  }
}

async function main() {
  console.log('🌱 Seeding database...');

  await ensureSchema();

  // Demo user
  const hash = await bcrypt.hash('password123', 12);

  const user = await prisma.user.upsert({
    where: { email: 'demo@docusense.app' },
    update: {},
    create: {
      email: 'demo@docusense.app',
      name: 'Demo User',
      passwordHash: hash,
      documentsCount: 3,
      queriesCount: 12,
    },
  });

  console.log(`✓ User: ${user.email}`);

  const demoDocuments: SeedDocument[] = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      title: 'Q4 Financial Report',
      fileName: 'q4_financial_report.pdf',
      storageKey: 'users/demo/q4_report.pdf',
      mimeType: 'application/pdf',
      content: 'Q4 Financial Report\n\nQ4 revenue grew 23% YoY to $4.2M. EBITDA margin improved to 18%. Key drivers: enterprise segment growth and operational efficiency gains.',
      status: 'READY',
      summary: 'Q4 revenue grew 23% YoY to $4.2M. EBITDA margin improved to 18%. Key drivers: enterprise segment growth and operational efficiency gains.',
      tags: ['finance', 'quarterly', 'report'],
      pageCount: 24,
      queryCount: 7,
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      title: 'Product Roadmap 2025',
      fileName: 'product_roadmap_2025.pdf',
      storageKey: 'users/demo/roadmap.pdf',
      mimeType: 'application/pdf',
      content: 'Product Roadmap 2025\n\nStrategic roadmap covering AI-native features, mobile expansion, and enterprise integrations planned for H1 and H2 2025.',
      status: 'READY',
      summary: 'Strategic roadmap covering AI-native features, mobile expansion, and enterprise integrations planned for H1 and H2 2025.',
      tags: ['product', 'roadmap', 'strategy'],
      pageCount: 12,
      queryCount: 5,
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      title: 'Engineering Architecture Spec',
      fileName: 'arch_spec_v2.pdf',
      storageKey: 'users/demo/arch_spec.pdf',
      mimeType: 'application/pdf',
      content: 'Engineering Architecture Spec\n\nHigh-level architecture covering document ingestion, chunking, embeddings, search, and storage.',
      status: 'PROCESSING',
      tags: ['engineering', 'architecture', 'technical'],
      pageCount: 0,
      queryCount: 0,
    },
  ];

  const uploadedDocuments = await Promise.all(
    demoDocuments.map(async (document) => {
      const stored = await uploadSeedDocument('users/demo/documents', document);
      return {
        ...document,
        storageKey: stored.key,
      };
    }),
  );

  // Demo documents
  const docs = await Promise.all(
    uploadedDocuments.map((document) =>
      prisma.document.upsert({
        where: { id: document.id },
        update: {
          storageKey: document.storageKey,
        },
        create: {
          id: document.id,
          userId: user.id,
          title: document.title,
          fileName: document.fileName,
          mimeType: document.mimeType,
          fileSizeBytes: Buffer.byteLength(document.content),
          storageKey: document.storageKey,
          status: document.status,
          summary: document.summary,
          tags: document.tags ?? [],
          pageCount: document.pageCount,
          queryCount: document.queryCount,
          processedAt: document.status === 'READY' ? new Date() : null,
        },
      }),
    ),
  );

  console.log(`✓ Documents: ${docs.length} seeded`);
  console.log('\n🎉 Seed complete!');
  console.log('   Email:    demo@docusense.app');
  console.log('   Password: password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
