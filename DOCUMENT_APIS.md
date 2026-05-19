# Document APIs - Postman Reference

**Base URL:** `http://localhost:3000/api/v1`

**Authentication:** All endpoints require `Authorization: Bearer {token}` header

---

## 1. Upload Document

**Endpoint:** `POST /documents`

**Content-Type:** `multipart/form-data`

**Request Body:**
```
file: <binary file>
  Allowed types: PDF, PNG, JPEG, WEBP, TXT, DOCX
  Max size: 50 MB
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/v1/documents \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@/path/to/document.pdf"
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "document": {
      "id": "doc_12345",
      "userId": "user_789",
      "title": "document",
      "fileName": "document.pdf",
      "mimeType": "application/pdf",
      "fileSizeBytes": 1024000,
      "storageKey": "users/user_789/documents/doc_12345.pdf",
      "status": "PENDING",
      "summary": null,
      "thumbnailUrl": null,
      "tags": [],
      "pageCount": null,
      "queryCount": 0,
      "createdAt": "2026-05-17T10:30:00.000Z",
      "processedAt": null
    },
    "jobId": "job_abc123"
  }
}
```

---

## 2. List Documents

**Endpoint:** `GET /documents`

**Query Parameters:**
- `page` (optional, default: 1) - Page number (min: 1)
- `limit` (optional, default: 20) - Items per page (min: 1, max: 100)
- `status` (optional) - Filter by status: `PENDING`, `PROCESSING`, `READY`, `FAILED`
- `search` (optional) - Search by title, summary, or fileName
- `tag` (optional) - Filter by tag

**cURL Example:**
```bash
curl -X GET "http://localhost:3000/api/v1/documents?page=1&limit=10&status=READY" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "doc_12345",
        "title": "document",
        "fileName": "document.pdf",
        "mimeType": "application/pdf",
        "fileSizeBytes": 1024000,
        "status": "READY",
        "summary": "This is a document summary...",
        "thumbnailUrl": "/files/doc_12345.png",
        "tags": ["finance", "important"],
        "pageCount": 10,
        "queryCount": 5,
        "createdAt": "2026-05-17T10:30:00.000Z",
        "processedAt": "2026-05-17T10:35:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 45,
      "totalPages": 5
    }
  }
}
```

---

## 3. Get Document by ID

**Endpoint:** `GET /documents/{id}`

**Path Parameters:**
- `id` (required) - Document ID

**cURL Example:**
```bash
curl -X GET http://localhost:3000/api/v1/documents/doc_12345 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "doc_12345",
    "userId": "user_789",
    "title": "document",
    "fileName": "document.pdf",
    "mimeType": "application/pdf",
    "fileSizeBytes": 1024000,
    "storageKey": "users/user_789/documents/doc_12345.pdf",
    "status": "READY",
    "summary": "This is a document summary...",
    "thumbnailUrl": "/files/doc_12345.png",
    "tags": ["finance", "important"],
    "pageCount": 10,
    "queryCount": 5,
    "createdAt": "2026-05-17T10:30:00.000Z",
    "processedAt": "2026-05-17T10:35:00.000Z",
    "_count": {
      "chunks": 42
    }
  }
}
```

---

## 4. Update Document

**Endpoint:** `PATCH /documents/{id}`

**Path Parameters:**
- `id` (required) - Document ID

**Content-Type:** `application/json`

**Request Body:**
```json
{
  "title": "Updated Document Title",
  "tags": ["finance", "updated", "important"]
}
```

**Validation Rules:**
- `title`: string (min: 1, max: 255) - optional
- `tags`: array of strings (max: 10 items) - optional

**cURL Example:**
```bash
curl -X PATCH http://localhost:3000/api/v1/documents/doc_12345 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "New Title",
    "tags": ["updated"]
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "doc_12345",
    "userId": "user_789",
    "title": "New Title",
    "fileName": "document.pdf",
    "mimeType": "application/pdf",
    "fileSizeBytes": 1024000,
    "storageKey": "users/user_789/documents/doc_12345.pdf",
    "status": "READY",
    "summary": "This is a document summary...",
    "thumbnailUrl": "/files/doc_12345.png",
    "tags": ["updated"],
    "pageCount": 10,
    "queryCount": 5,
    "createdAt": "2026-05-17T10:30:00.000Z",
    "processedAt": "2026-05-17T10:35:00.000Z"
  }
}
```

---

## 5. Delete Document

**Endpoint:** `DELETE /documents/{id}`

**Path Parameters:**
- `id` (required) - Document ID

**cURL Example:**
```bash
curl -X DELETE http://localhost:3000/api/v1/documents/doc_12345 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Document deleted"
  }
}
```

---

## 6. Get Document Chunks

**Endpoint:** `GET /documents/{id}/chunks`

**Path Parameters:**
- `id` (required) - Document ID

**Description:** Retrieves all chunks (processed segments) of a document

**cURL Example:**
```bash
curl -X GET http://localhost:3000/api/v1/documents/doc_12345/chunks \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "chunk_1",
      "content": "This is the first chunk of the document...",
      "pageNumber": 1,
      "chunkIndex": 0
    },
    {
      "id": "chunk_2",
      "content": "This is the second chunk of the document...",
      "pageNumber": 1,
      "chunkIndex": 1
    }
  ]
}
```

---

## 7. Get Job Status

**Endpoint:** `GET /documents/jobs/{jobId}/status`

**Path Parameters:**
- `jobId` (required) - Job ID from upload or reprocess response

**Description:** Check the processing status of an ingestion job

**cURL Example:**
```bash
curl -X GET http://localhost:3000/api/v1/documents/jobs/job_abc123/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "job_abc123",
    "state": "completed",
    "progress": {
      "total": 10,
      "completed": 10
    },
    "data": {
      "documentId": "doc_12345",
      "chunksCreated": 42,
      "embeddingsGenerated": 42
    },
    "finishedOn": "2026-05-17T10:35:00.000Z",
    "failedReason": null
  }
}
```

**Job States:**
- `waiting` - Job queued, not started
- `active` - Job currently processing
- `completed` - Job finished successfully
- `failed` - Job processing failed

---

## 8. Reprocess Document

**Endpoint:** `POST /documents/{id}/reprocess`

**Path Parameters:**
- `id` (required) - Document ID

**Description:** Re-extract and re-embed a document (resets status to PENDING and deletes old chunks)

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/v1/documents/doc_12345/reprocess \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "jobId": "job_xyz789",
    "documentId": "doc_12345"
  }
}
```

---

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "code": "NO_FILE",
  "message": "No file provided",
  "error": {
    "code": "NO_FILE",
    "message": "No file provided"
  }
}
```

### 404 Not Found
```json
{
  "success": false,
  "code": "NOT_FOUND",
  "message": "Document not found",
  "error": {
    "code": "NOT_FOUND",
    "message": "Document not found"
  }
}
```

### 403 Forbidden
```json
{
  "success": false,
  "code": "FORBIDDEN",
  "message": "You do not have permission to access this resource",
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this resource"
  }
}
```

### 415 Unsupported Media Type
```json
{
  "success": false,
  "code": "UNSUPPORTED_MEDIA_TYPE",
  "message": "Unsupported file type: application/x-executable",
  "error": {
    "code": "UNSUPPORTED_MEDIA_TYPE",
    "message": "Unsupported file type: application/x-executable"
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
      "limit": ["Number must be less than or equal to 100"]
    }
  }
}
```

---

## Document Status Values

- **PENDING** - File uploaded, waiting for processing
- **PROCESSING** - Currently extracting and embedding
- **READY** - Ready for search and RAG queries
- **FAILED** - Processing failed, check logs for details

---

## Required Headers

All requests must include:
```
Authorization: Bearer {access_token}
Content-Type: application/json  (except multipart uploads)
```

---

## Postman Collection Import

You can import this as a Postman environment:

```json
{
  "name": "DocuSense API",
  "values": [
    {
      "key": "base_url",
      "value": "http://localhost:3000/api/v1",
      "type": "string",
      "enabled": true
    },
    {
      "key": "token",
      "value": "YOUR_ACCESS_TOKEN",
      "type": "string",
      "enabled": true
    }
  ]
}
```

Then use `{{base_url}}` and `{{token}}` in your requests.
