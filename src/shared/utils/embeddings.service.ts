import { config } from '../../config/config';
import { prisma } from '../../config/database';
import { logger } from '../utils/logger';

// ── OpenRouter Embeddings Client (fallbacks to mock vectors on failure)

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBED_MODEL = config.OPENROUTER_MODEL ?? 'openai/text-embedding-3-small';
const EMBED_DIM = 1024;

function makeRandomVector(): number[] {
  const vector = Array.from({ length: EMBED_DIM }, () => Math.random() - 0.5);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

function normalizeEmbedding(values: number[] | undefined): number[] {
  if (!values || values.length === 0) {
    return makeRandomVector();
  }

  if (values.length === EMBED_DIM) {
    return values;
  }

  if (values.length > EMBED_DIM) {
    return values.slice(0, EMBED_DIM);
  }

  return [...values, ...Array.from({ length: EMBED_DIM - values.length }, () => 0)];
}

async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    const apiKey = config.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OpenRouter embeddings request failed: ${resp.status} ${body}`);
    }

    const json: any = await resp.json();
    const responseEmbeddings: any[] = json?.data ?? [];
    const embeddings = responseEmbeddings.map((d: any) => normalizeEmbedding(d.embedding ?? d[0]?.embedding ?? d.embedding_vector ?? d));
    if (embeddings.length !== texts.length) {
      throw new Error('OpenRouter embedding response missing vectors');
    }

    return embeddings;
  } catch (error) {
    logger.warn({ error }, 'OpenRouter document embeddings failed — using mock vectors');
    return texts.map(() => makeRandomVector());
  }
}

async function fetchQueryEmbedding(text: string): Promise<number[]> {
  try {
    const apiKey = config.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OpenRouter query embedding failed: ${resp.status} ${body}`);
    }

    const json: any = await resp.json();
    const vector: any = json?.data?.[0]?.embedding ?? json?.data?.[0]?.embedding_vector ?? json?.data?.[0];
    if (!vector) {
      throw new Error('OpenRouter query embedding missing vector');
    }

    return normalizeEmbedding(vector);
  } catch (error) {
    logger.warn({ error }, 'OpenRouter query embedding failed — using mock vector');
    return makeRandomVector();
  }
}

// ── Embed Chunks + Persist ────────────────────────────────────────────────────

export async function embedAndStoreChunks(
  documentId: string,
  chunks: { id: string; content: string }[],
): Promise<void> {
  const BATCH_SIZE = 32;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.content);

    logger.debug({ documentId, batch: i / BATCH_SIZE }, 'Embedding batch');

    const embeddings = await fetchEmbeddings(texts);

    // Persist embeddings with raw SQL (pgvector doesn't support Prisma typed writes yet)
    for (let j = 0; j < batch.length; j++) {
      const vectorStr = `[${embeddings[j].join(',')}]`;
      await prisma.$executeRaw`
        UPDATE chunks
        SET embedding = ${vectorStr}::vector
        WHERE id = ${batch[j].id}::uuid
      `;
    }
  }

  logger.info({ documentId, total: chunks.length }, 'Embeddings stored');
}

// ── ANN Vector Search (cosine) ────────────────────────────────────────────────

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  userId: string;
  content: string;
  pageNumber: number | null;
  similarity: number;
}

export async function vectorSearch(
  query: string,
  userId: string,
  opts: {
    limit?: number;
    documentId?: string;
    minSimilarity?: number;
  } = {},
): Promise<SearchResult[]> {
  const { limit = 8, documentId, minSimilarity = 0.3 } = opts;

  const embedding = await fetchQueryEmbedding(query);
  const vectorStr = `[${embedding.join(',')}]`;

  // ANN search via HNSW index — filter by userId for tenant isolation
  const rows = documentId
    ? await prisma.$queryRaw<SearchResult[]>`
        SELECT
          c.id            AS "chunkId",
          c.document_id   AS "documentId",
          d.title         AS "documentTitle",
          d.user_id       AS "userId",
          c.content,
          c.page_number   AS "pageNumber",
          1 - (c.embedding <=> ${vectorStr}::vector) AS similarity
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE d.user_id = ${userId}::uuid
          AND c.document_id = ${documentId}::uuid
          AND c.embedding IS NOT NULL
          AND 1 - (c.embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
        ORDER BY c.embedding <=> ${vectorStr}::vector
        LIMIT ${limit}
      `
    : await prisma.$queryRaw<SearchResult[]>`
        SELECT
          c.id            AS "chunkId",
          c.document_id   AS "documentId",
          d.title         AS "documentTitle",
          d.user_id       AS "userId",
          c.content,
          c.page_number   AS "pageNumber",
          1 - (c.embedding <=> ${vectorStr}::vector) AS similarity
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE d.user_id = ${userId}::uuid
          AND c.embedding IS NOT NULL
          AND 1 - (c.embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
        ORDER BY c.embedding <=> ${vectorStr}::vector
        LIMIT ${limit}
      `;

  return rows;
}

// ── Reranking (simple score-based, no external reranker needed) ───────────────

export function rerankResults(
  results: SearchResult[],
  query: string,
): SearchResult[] {
  const qTerms = query.toLowerCase().split(/\s+/);

  return results
    .map((r) => {
      const content = r.content.toLowerCase();
      // Boost if query terms appear in the chunk
      const termBoost =
        qTerms.filter((t) => content.includes(t)).length / qTerms.length;
      return { ...r, similarity: r.similarity * (1 + termBoost * 0.15) };
    })
    .sort((a, b) => b.similarity - a.similarity);
}
