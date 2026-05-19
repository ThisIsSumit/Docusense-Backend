# Search APIs - Postman Reference

**Base URL:** `http://localhost:3000/api/v1`

**Authentication:** All endpoints require `Authorization: Bearer {token}` header (except `POST /auth/register` and `POST /auth/login`)

---

## 1. Semantic Search (Vector Search)

**Endpoint:** `GET /search`

**Description:** Search for relevant document chunks using semantic similarity without generating an AI answer

**Query Parameters:**
- `q` (required) - Search query (min: 1, max: 500 chars)
- `documentId` (optional) - Filter results to specific document
- `limit` (optional, default: 8) - Max results to return (min: 1, max: 20)
- `minSimilarity` (optional, default: 0.3) - Minimum similarity score (0-1)

**cURL Example:**
```bash
curl -X GET "http://localhost:3000/api/v1/search?q=financial+results&limit=5&minSimilarity=0.5" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "query": "financial results",
    "results": [
      {
        "chunkId": "chunk_1a2b3c",
        "documentId": "doc_12345",
        "documentTitle": "Annual Report 2025",
        "pageNumber": 5,
        "similarity": 0.89,
        "content": "The financial results for Q1 2025 show a 15% increase in revenue..."
      },
      {
        "chunkId": "chunk_2d3e4f",
        "documentId": "doc_12345",
        "documentTitle": "Annual Report 2025",
        "pageNumber": 8,
        "similarity": 0.82,
        "content": "Operating expenses decreased by 8% compared to the previous year..."
      }
    ],
    "total": 2
  }
}
```

---

## 2. RAG Query (AI-Generated Answer)

**Endpoint:** `POST /search/query`

**Content-Type:** `application/json`

**Description:** Ask a question and get an AI-generated answer based on relevant document chunks (supports streaming)

**Request Body:**
```json
{
  "question": "What were the main challenges discussed?",
  "documentId": "doc_12345",
  "stream": false
}
```

**Parameters:**
- `question` (required) - Your question (min: 1, max: 1000 chars)
- `documentId` (optional) - Limit search to specific document
- `stream` (optional, default: false) - If true, stream answer via SSE

**cURL Example (Non-streaming):**
```bash
curl -X POST http://localhost:3000/api/v1/search/query \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What were the main challenges discussed?",
    "stream": false
  }'
```

**Response (200 OK - Non-streaming):**
```json
{
  "success": true,
  "data": {
    "question": "What were the main challenges discussed?",
    "answer": "The main challenges discussed include market volatility, supply chain disruptions, and increased competition. According to the documents, these factors led to a 12% margin compression in Q2 2025, which management is addressing through operational optimization and strategic partnerships.",
    "sources": [
      {
        "chunkId": "chunk_5g6h7i",
        "documentId": "doc_12345",
        "documentTitle": "Annual Report 2025",
        "pageNumber": 12,
        "similarity": 0.91,
        "excerpt": "Market volatility and supply chain disruptions posed significant challenges..."
      },
      {
        "chunkId": "chunk_8j9k0l",
        "documentId": "doc_67890",
        "documentTitle": "Executive Summary",
        "pageNumber": 3,
        "similarity": 0.85,
        "excerpt": "Increased competition in the enterprise segment requires innovation..."
      }
    ],
    "meta": {
      "tokensUsed": 450,
      "latencyMs": 3200,
      "chunksSearched": 2
    }
  }
}
```

**Streaming Example (SSE):**
```bash
curl -X POST http://localhost:3000/api/v1/search/query \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question": "What were the results?", "stream": true}'
```

**Streaming Response:**
```
data: {"type":"sources","sources":[{"chunkId":"chunk_1","similarity":0.89}]}

data: {"type":"chunk","answer":"The main results show"}

data: {"type":"chunk","answer":" strong growth across all"}

data: {"type":"chunk","answer":" business segments..."}

data: {"type":"done","tokensUsed":350}
```

---

## 3. Query History

**Endpoint:** `GET /search/history`

**Description:** Get paginated history of all user queries

**Query Parameters:**
- `page` (optional, default: 1) - Page number
- `limit` (optional, default: 20) - Items per page (max: 50)

**cURL Example:**
```bash
curl -X GET "http://localhost:3000/api/v1/search/history?page=1&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "query_abc123",
        "question": "What are the key metrics?",
        "answer": "The key metrics for Q1 2025 include...",
        "tokensUsed": 420,
        "latencyMs": 2800,
        "createdAt": "2026-05-17T10:45:00.000Z",
        "document": {
          "id": "doc_12345",
          "title": "Annual Report 2025"
        }
      },
      {
        "id": "query_def456",
        "question": "Summarize the financial results",
        "answer": "The financial results show strong performance...",
        "tokensUsed": 380,
        "latencyMs": 2500,
        "createdAt": "2026-05-17T09:30:00.000Z",
        "document": {
          "id": "doc_xyz789",
          "title": "Q1 Financial Statement"
        }
      }
    ],
    "total": 45,
    "page": 1,
    "limit": 10,
    "hasMore": true
  }
}
```

---

## Error Responses

### 404 No Content Found
```json
{
  "success": false,
  "code": "NO_CONTEXT",
  "message": "No relevant content found for this question",
  "error": {
    "code": "NO_CONTEXT",
    "message": "No relevant content found for this question"
  }
}
```

### 422 Validation Error
```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "q": ["String must contain at least 1 character(s)"],
      "limit": ["Number must be less than or equal to 20"]
    }
  }
}
```

---

## Search Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `chunkId` | string | Unique identifier for the text chunk |
| `documentId` | string | ID of the source document |
| `documentTitle` | string | Title of the source document |
| `pageNumber` | number | Page number in the source document |
| `similarity` | number | Relevance score (0-1, higher is more relevant) |
| `content` | string | Actual text chunk content |

---

## Notes

- **Similarity Threshold**: Adjust `minSimilarity` to control result relevance (0.3 = loose, 0.8 = strict)
- **Streaming**: Use `stream: true` for real-time answer generation (useful for long-form responses)
- **Rate Limiting**: All search endpoints are rate-limited to prevent abuse
- **Token Usage**: Approximate token count for billing/monitoring purposes
- **Latency**: Response time includes embedding generation and LLM inference
