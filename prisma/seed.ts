import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

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

  // Demo documents
  const docs = await Promise.all([
    prisma.document.upsert({
      where: { id: '00000000-0000-0000-0000-000000000001' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000001',
        userId: user.id,
        title: 'Q4 Financial Report',
        fileName: 'q4_financial_report.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 2_048_000,
        storageKey: 'users/demo/q4_report.pdf',
        status: 'READY',
        summary: 'Q4 revenue grew 23% YoY to $4.2M. EBITDA margin improved to 18%. Key drivers: enterprise segment growth and operational efficiency gains.',
        tags: ['finance', 'quarterly', 'report'],
        pageCount: 24,
        queryCount: 7,
        processedAt: new Date(),
      },
    }),
    prisma.document.upsert({
      where: { id: '00000000-0000-0000-0000-000000000002' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000002',
        userId: user.id,
        title: 'Product Roadmap 2025',
        fileName: 'product_roadmap_2025.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1_024_000,
        storageKey: 'users/demo/roadmap.pdf',
        status: 'READY',
        summary: 'Strategic roadmap covering AI-native features, mobile expansion, and enterprise integrations planned for H1 and H2 2025.',
        tags: ['product', 'roadmap', 'strategy'],
        pageCount: 12,
        queryCount: 5,
        processedAt: new Date(),
      },
    }),
    prisma.document.upsert({
      where: { id: '00000000-0000-0000-0000-000000000003' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000003',
        userId: user.id,
        title: 'Engineering Architecture Spec',
        fileName: 'arch_spec_v2.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 512_000,
        storageKey: 'users/demo/arch_spec.pdf',
        status: 'PROCESSING',
        tags: ['engineering', 'architecture', 'technical'],
        pageCount: 0,
        queryCount: 0,
      },
    }),
  ]);

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
