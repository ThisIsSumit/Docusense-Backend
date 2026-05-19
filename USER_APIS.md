# User APIs - Postman Reference

**Base URL:** `http://localhost:3000/api/v1`

**Authentication:** All endpoints require `Authorization: Bearer {token}` header

---

## 1. Get User Stats & Dashboard

**Endpoint:** `GET /users/me/stats`

**Description:** Get user profile statistics, document counts by status, and recent queries

**cURL Example:**
```bash
curl -X GET http://localhost:3000/api/v1/users/me/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "documentsCount": 15,
    "queriesCount": 42,
    "memberSince": "2026-01-15T08:30:00.000Z",
    "documentsByStatus": {
      "PENDING": 2,
      "PROCESSING": 0,
      "READY": 12,
      "FAILED": 1
    },
    "recentQueries": [
      {
        "id": "query_abc123",
        "question": "What are the key findings in this document?",
        "createdAt": "2026-05-17T10:45:00.000Z",
        "document": {
          "id": "doc_xyz789",
          "title": "Annual Report 2025"
        }
      },
      {
        "id": "query_def456",
        "question": "Summarize the financial results",
        "createdAt": "2026-05-17T09:30:00.000Z",
        "document": {
          "id": "doc_abc123",
          "title": "Q1 Financial Statement"
        }
      }
    ]
  }
}
```

---

## 2. Update User Profile

**Endpoint:** `PATCH /users/me`

**Content-Type:** `application/json`

**Request Body:**
```json
{
  "name": "John Doe",
  "avatarUrl": "https://example.com/avatar.jpg"
}
```

**Validation Rules:**
- `name`: string (min: 2, max: 100) - optional
- `avatarUrl`: valid URL or null - optional

**cURL Example:**
```bash
curl -X PATCH http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "avatarUrl": "https://example.com/new-avatar.jpg"
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "user_12345",
    "name": "Jane Smith",
    "email": "jane@example.com",
    "avatarUrl": "https://example.com/new-avatar.jpg",
    "updatedAt": "2026-05-17T11:20:00.000Z"
  }
}
```

---

## 3. Delete User Account

**Endpoint:** `DELETE /users/me`

**Description:** Permanently delete the user account and all associated data (documents, chunks, queries, sessions)

**⚠️ WARNING:** This action is permanent and cannot be undone

**cURL Example:**
```bash
curl -X DELETE http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Account deleted"
  }
}
```

---

## Response Field Descriptions

### User Stats Response

| Field | Type | Description |
|-------|------|-------------|
| `documentsCount` | number | Total number of documents uploaded |
| `queriesCount` | number | Total number of queries/questions asked |
| `memberSince` | ISO 8601 datetime | Account creation date |
| `documentsByStatus` | object | Breakdown of documents by processing status |
| `recentQueries` | array | Last 5 queries with related document info |

### Document Status Breakdown

| Status | Meaning |
|--------|---------|
| `PENDING` | Uploaded but not yet processed |
| `PROCESSING` | Currently extracting chunks and generating embeddings |
| `READY` | Ready for search and RAG queries |
| `FAILED` | Processing failed, try reprocessing |

### Update Profile Response

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | User ID |
| `name` | string | Display name |
| `email` | string | Email address (read-only) |
| `avatarUrl` | string \| null | Profile avatar URL |
| `updatedAt` | ISO 8601 datetime | Last update timestamp |

---

## Error Responses

### 404 Not Found
```json
{
  "success": false,
  "code": "NOT_FOUND",
  "message": "User not found",
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found"
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
      "name": ["String must contain at least 2 character(s)"],
      "avatarUrl": ["Invalid url"]
    }
  }
}
```

---

## Required Headers

All requests must include:
```
Authorization: Bearer {access_token}
Content-Type: application/json  (for PATCH requests)
```

---

## Usage Notes

- **Get Stats**: Call this endpoint to populate user dashboard/profile page
- **Update Profile**: Users can update their display name and avatar
- **Delete Account**: Cascading delete removes all user data including documents, chunks, embeddings, and queries
- **Read-only Fields**: Email cannot be changed via API (would need separate email verification endpoint)

---

## Postman Collection Import

Use the same environment variables:

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
