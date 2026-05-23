# DocuSense Backend API

> Node.js · TypeScript · Express · Prisma · pgvector · BullMQ · Claude API

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Flutter Client                          │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP / SSE
┌───────────────────────▼─────────────────────────────────────┐
│               Express API  :3000                            │
│  /api/v1/auth  /documents  /search  /users                  │
│  Helmet · CORS · Rate Limit · JWT Auth · Zod Validation     │
└──────┬──────────────────────────┬────────────────────────────┘
       │                          │
┌──────▼───────┐        ┌─────────▼────────────────────────────┐
│  PostgreSQL  │        │           Redis                       │
│  + pgvector  │        │  Token blacklist · Session cache      │
│  (Prisma)    │        │  BullMQ job queues                    │
└──────┬───────┘        └──────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────┐
│                    BullMQ Worker (separate process)         │
│                                                             │
│  INGEST queue                  EMBED queue                  │
│  ├─ Extract text               ├─ Voyage AI embeddings      │
│  ├─ Claude tool-use extraction ├─ Batch 32 chunks           │
│  ├─ Chunk text (1000/200)      └─ HNSW index via pgvector   │
│  └─ Enqueue EMBED job                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Auth  `/api/v1/auth`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | — | Create account |
| POST | `/login` | — | Login → JWT tokens |
| POST | `/refresh` | — | Rotate access + refresh tokens |
| POST | `/logout` | ✓ | Blacklist token + delete session |
| POST | `/logout-all` | ✓ | Terminate all sessions |
| GET | `/me` | ✓ | Current user profile |
| PUT | `/change-password` | ✓ | Update password |

### Documents  `/api/v1/documents`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Upload file (multipart/form-data, field: `file`) |
| GET | `/` | List documents (page, limit, status, search, tag) |
| GET | `/:id` | Get document detail |
| PATCH | `/:id` | Update title / tags |
| DELETE | `/:id` | Delete document + chunks + storage |
| GET | `/:id/chunks` | Get all text chunks |
| GET | `/jobs/:jobId/status` | Poll ingestion job status |

### Search  `/api/v1/search`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/?q=...` | Semantic chunk search (no AI answer) |
| POST | `/query` | RAG answer (stream=true for SSE) |
| GET | `/history` | User query history |

### Users  `/api/v1/users`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/me/stats` | Dashboard stats |
| PATCH | `/me` | Update profile |
| DELETE | `/me` | Delete account |

---

## Setup

### 1. Prerequisites
- Node.js 20+
- Docker + Docker Compose (for Postgres + Redis)
- pnpm or npm

### 2. Install
```bash
npm install
```

### 3. Environment
```bash
cp .env.example .env
# Fill in GEMINI_API_KEY and VOYAGE_API_KEY
```

### 4. Start infrastructure
```bash
docker compose up -d
# Starts pgvector/postgres:16 + redis:7
```

### Render + Supabase deployment
Use this when you want hosted storage and a managed deployment platform:

1. Create a Supabase project.
2. Create a private Storage bucket, for example `documents`.
3. Copy `SUPABASE_URL` and the service role key into your Render env vars.
4. Set `STORAGE_PROVIDER=supabase`.
5. Connect this repo to Render and deploy with `render.yaml`.
6. Use Supabase Postgres and an external Redis provider such as Upstash.

Required Render env vars:
```bash
DATABASE_URL=...                 # Supabase Postgres
REDIS_URL=...                    # Upstash or Render Redis
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=documents
STORAGE_PROVIDER=supabase
CORS_ORIGINS=https://your-frontend-url
```

### 5. Database setup
```bash
npm run db:migrate    # Run Prisma migrations
npm run db:seed       # Seed demo user + documents
```

### 6. Run
```bash
# Terminal 1 — API server
npm run dev

# Terminal 2 — BullMQ worker (document processing)
npm run worker
```

---

## Key Design Decisions

### Auth — JWT + Refresh Token Rotation
- Access tokens: 15 min expiry, signed with `JWT_ACCESS_SECRET`
- Refresh tokens: 7 days, stored in `sessions` table, rotated on every use
- Logout: access token blacklisted in Redis (TTL = remaining token lifetime)
- All sessions table rows deleted on `logout-all`

### RAG Pipeline
```
Upload → BullMQ INGEST → Claude tool_use extraction → chunk(1000/200 overlap)
       → BullMQ EMBED  → Voyage AI batch embeddings → pgvector HNSW storage
Query  → Voyage AI query embed → ANN cosine search → term-boost rerank
       → Claude SSE stream answer with [Source N] citations
```

### pgvector HNSW Index
```sql
CREATE INDEX chunks_embedding_hnsw_idx
ON chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```
Sub-millisecond ANN on 100k+ chunks at ef_search=40.

### Tenant Isolation
Every query filters by `d.user_id = $userId` before vector similarity — users can never see each other's documents.

### SSE Streaming
`POST /search/query` with `{ stream: true }` upgrades to `text/event-stream`:
```
data: {"type":"sources","sources":[...]}

data: {"type":"delta","text":"Based on"}

data: {"type":"delta","text":" the Q4 report..."}

data: {"type":"done","totalTokens":342}
```

---

## Project Structure

```
src/
├── config/
│   ├── config.ts          Zod-validated env vars
│   ├── database.ts        Prisma client + pgvector init
│   └── redis.ts           ioredis singleton + helpers
│
├── middleware/
│   ├── auth.middleware.ts  JWT verify, blacklist, token gen
│   ├── error.middleware.ts Global error handler + 404
│   └── rate-limit.ts       API / auth / upload limiters
│
├── modules/
│   ├── auth/              register, login, refresh, logout
│   ├── documents/         upload, list, CRUD, job status
│   ├── search/            vector search, RAG query, history
│   └── users/             profile, stats, account delete
│
├── shared/
│   ├── types/api.types.ts  Response helpers, custom errors
│   └── utils/
│       ├── ai.service.ts       Gemini API: extraction + streaming
│       ├── embeddings.service.ts Voyage AI + pgvector ANN
│       ├── queue.ts            BullMQ queue definitions
│       ├── storage.service.ts  Local / S3 abstraction
│       └── logger.ts           Pino structured logger
│
├── jobs/worker.ts          BullMQ INGEST + EMBED workers
├── app.ts                  Express app factory
└── main.ts                 Bootstrap + graceful shutdown

prisma/
├── schema.prisma           PostgreSQL schema + pgvector
└── seed.ts                 Demo data

docker/
└── init.sql                Enable pgvector + uuid-ossp
```

---

## Flutter Integration

Update `lib/core/utils/dio_client.dart`:
```dart
static const baseUrl = 'http://localhost:3000/api/v1';
```

Upload a file:
```dart
final formData = FormData.fromMap({
  'file': await MultipartFile.fromFile(path, filename: name),
});
await dio.post('/documents', data: formData);
```

Stream a query answer:
```dart
final response = await dio.post('/search/query',
  data: {'question': q, 'stream': true},
  options: Options(responseType: ResponseType.stream));
// Parse SSE events from response.data.stream
```

---

## Resume Bullets

- Built RAG pipeline: Voyage AI 1024-dim embeddings → pgvector HNSW index (m=16, ef=64) → cosine ANN → term-boost rerank → Gemini SSE streaming, achieving sub-200ms retrieval on 100k chunks
- Implemented JWT auth with 15-min access tokens, 7-day rotating refresh tokens, Redis blacklist, and per-session revocation via Prisma sessions table
- Designed BullMQ async ingestion pipeline (3 concurrent workers) with exponential backoff retry, progress tracking, and automatic HNSW index population
- Architected multi-tenant vector search with user-scoped SQL filters preventing cross-user data leakage at the query layer
- Delivered SSE streaming endpoint piping Claude token deltas to Flutter client at ~40 tok/s with source citation metadata sent before stream begins
