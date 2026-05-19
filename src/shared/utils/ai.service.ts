import { Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { config } from '../../config/config';
import { logger } from '../utils/logger';

const MODEL = config.OPENROUTER_CHAT_MODEL ?? 'gpt-4o-mini';

const generationConfig = {};

// Provide a client abstraction that uses GoogleGenAI when GEMINI_API_KEY is set,
// otherwise falls back to OpenRouter using `OPENROUTER_API_KEY`.
const openRouterChatUrl = 'https://openrouter.ai/api/v1/chat/completions';

function contentsToMessages(contents: any[]) {
  return contents.map((c) => ({
    role: c.role,
    content: c.parts?.map((p: any) => p.text).join('') ?? '',
  }));
}

let client: any;
// Prefer OpenRouter when configured to avoid Google ADC usage.
if (config.OPENROUTER_API_KEY) {
  const apiKey = config.OPENROUTER_API_KEY;
  client = {
    models: {
      async generateContent({ model, config: _cfg, contents }: any) {
        const messages = contentsToMessages(contents ?? []);
        const resp = await fetch(openRouterChatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: model || MODEL, messages }),
        });

        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`OpenRouter generateContent failed ${resp.status}: ${body}`);
        }

        const json: any = await resp.json();
        const choice = json?.choices?.[0] ?? {};
        const text = choice?.message?.content ?? choice?.text ?? '';
        return { text };
      },

      // Minimal stream implementation that yields a single full-text chunk.
      async *generateContentStream({ model, config: _cfg, contents }: any) {
        const result = await client.models.generateContent({ model, config: _cfg, contents });
        yield { text: result.text };
      },
    },
  };
}  else {
  // No provider configured — create a client that throws helpful errors.
  client = {
    models: {
      async generateContent() {
        throw new Error('No AI provider configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY.');
      },
      async *generateContentStream() {
        throw new Error('No AI provider configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY.');
      },
    },
  };
}

// ── Document Extraction (Tool Use) ────────────────────────────────────────────

export interface ExtractedDocument {
  title: string;
  summary: string;
  tags: string[];
  pageCount: number;
  keyEntities: { name: string; type: string }[];
  keyDates: { date: string; event: string }[];
  language: string;
  documentType: string;
}

const extractionSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Document title or best descriptive title' },
    summary: { type: 'string', description: 'Concise 2-3 sentence summary' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Relevant topic tags (max 8)' },
    pageCount: { type: 'number', description: 'Estimated or actual page count' },
    keyEntities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['person', 'organization', 'location', 'product', 'other'] },
        },
        required: ['name', 'type'],
      },
    },
    keyDates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          event: { type: 'string' },
        },
        required: ['date', 'event'],
      },
    },
    language: { type: 'string', description: 'Document language (ISO 639-1 code)' },
    documentType: {
      type: 'string',
      enum: ['report', 'contract', 'research', 'technical', 'invoice', 'letter', 'presentation', 'other'],
    },
  },
  required: ['title', 'summary', 'tags', 'pageCount', 'keyEntities', 'keyDates', 'language', 'documentType'],
} as const;

function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

function parseJsonPayload<T>(text: string, fallbackError: string): T {
  const normalized = stripJsonFences(text);
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  const candidate = start >= 0 && end >= start ? normalized.slice(start, end + 1) : normalized;

  try {
    return JSON.parse(candidate) as T;
  } catch (error) {
    logger.error({ error, text: normalized }, fallbackError);
    throw new Error(fallbackError);
  }
}

export async function extractDocumentStructure(
  content: string,
  fileName: string,
): Promise<ExtractedDocument> {
  const prompt = `Extract structured information from this document and return JSON only that matches this schema exactly:\n${JSON.stringify(extractionSchema, null, 2)}\n\nFile: ${fileName}\n\nContent:\n${content.slice(0, 80000)}`;

  logger.debug(
    {
      fileName,
      contentLength: content.length,
      promptLength: prompt.length,
      model: MODEL,
    },
    'Sending extraction request to AI',
  );

  const response = await client.models.generateContent({
    model: MODEL,
    config: generationConfig,
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  });

  const text = response.text;
  if (!text) {
    throw new Error('AI failed to extract document structure');
  }

  logger.debug(
    {
      fileName,
      responseLength: text.length,
      responsePreview: text.slice(0, 500),
    },
    'AI extraction response received',
  );

  return parseJsonPayload<ExtractedDocument>(text, 'AI returned invalid document structure JSON');
}

// ── Text Chunking ─────────────────────────────────────────────────────────────

export function chunkText(
  text: string,
  chunkSize = 1000,
  overlap = 200,
): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunkEnd = end;

    // Try to break at sentence boundary, but never stall on the last chunk.
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const breakAt = Math.max(lastPeriod, lastNewline);
      if (breakAt > start + chunkSize * 0.5) {
        chunkEnd = breakAt + 1;
      }
    }

    const chunk = text.slice(start, chunkEnd).trim();
    if (chunk.length > 50) {
      chunks.push(chunk);
    }

    if (chunkEnd >= text.length) {
      break;
    }

    const nextStart = Math.max(chunkEnd - overlap, start + 1);
    if (nextStart <= start) {
      break;
    }
    start = nextStart;
  }

  return chunks;
}

// ── RAG Answer Generation (SSE Streaming) ────────────────────────────────────

export interface SourceChunk {
  chunkId: string;
  content: string;
  documentId: string;
  documentTitle: string;
  pageNumber?: number | null;
  similarity: number;
}

export async function generateAnswerStream(
  question: string,
  chunks: SourceChunk[],
  res: Response,
  documentTitle?: string,
): Promise<string> {
  // Build context
  const context = chunks
    .map(
      (c, i) =>
        `[Source ${i + 1} — ${c.documentTitle}${c.pageNumber ? `, page ${c.pageNumber}` : ''}]\n${c.content}`,
    )
    .join('\n\n---\n\n');

  const systemPrompt = `You are DocuSense, an AI assistant that answers questions about documents.
Answer using ONLY the provided context. Be concise and precise.
Always cite your sources using [Source N] notation.
If the answer is not in the context, say so clearly.
${documentTitle ? `The user is asking about: ${documentTitle}` : ''}`;

  const userMessage = `Context:\n${context}\n\nQuestion: ${question}`;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let fullAnswer = '';

  // Send source metadata first
  res.write(
    `data: ${JSON.stringify({
      type: 'sources',
      sources: chunks.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        pageNumber: c.pageNumber,
        similarity: c.similarity,
      })),
    })}\n\n`,
  );

  // Stream answer tokens
    const stream = await client.models.generateContentStream({
    model: MODEL,
      config: generationConfig,
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\n${userMessage}` }],
        },
      ],
  });

  for await (const event of stream) {
      const text = event.text;
      if (text) {
      fullAnswer += text;
      res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ type: 'done', totalTokens: fullAnswer.length })}\n\n`);
  res.end();

  return fullAnswer;
}

// ── Non-streaming answer ──────────────────────────────────────────────────────

export async function generateAnswer(
  question: string,
  chunks: SourceChunk[],
  documentTitle?: string,
): Promise<{ answer: string; tokensUsed: number }> {
  const context = chunks
    .map((c, i) => `[Source ${i + 1}]\n${c.content}`)
    .join('\n\n');

  const response = await client.models.generateContent({
    model: MODEL,
    config: generationConfig,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are DocuSense. Answer using ONLY the context. Cite sources with [Source N].${documentTitle ? ` Document: ${documentTitle}` : ''}\n\nContext:\n${context}\n\nQuestion: ${question}`,
          },
        ],
      },
    ],
  });

  const answer = response.text ?? '';

  return { answer, tokensUsed: answer.length };
}
