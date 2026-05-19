# Auth APIs - Postman Reference

**Base URL:** `http://localhost:3000/api/v1`

---

## 1. Register

**Endpoint:** `POST /auth/register`

**Content-Type:** `application/json`

**Description:** Create a new user account

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

**Validation Rules:**
- `name`: string (min: 2, max: 100) - required
- `email`: valid email format - required
- `password`: string (min: 8, max: 128) - required

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "SecurePassword123!"
  }'
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_12345",
      "name": "John Doe",
      "email": "john@example.com",
      "avatarUrl": null,
      "createdAt": "2026-05-17T11:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "refresh_token_xyz789...",
      "expiresIn": 3600
    }
  }
}
```

---

## 2. Login

**Endpoint:** `POST /auth/login`

**Content-Type:** `application/json`

**Description:** Authenticate and get access/refresh tokens

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

**Validation Rules:**
- `email`: valid email format - required
- `password`: string (min: 1) - required

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePassword123!"
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_12345",
      "name": "John Doe",
      "email": "john@example.com",
      "avatarUrl": null,
      "createdAt": "2026-05-17T11:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "refresh_token_xyz789...",
      "expiresIn": 3600
    }
  }
}
```

---

## 3. Refresh Tokens

**Endpoint:** `POST /auth/refresh`

**Content-Type:** `application/json`

**Description:** Get new access token using refresh token

**Request Body:**
```json
{
  "refreshToken": "refresh_token_xyz789..."
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "refresh_token_xyz789..."
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "new_refresh_token_abc123...",
    "expiresIn": 3600
  }
}
```

---

## 4. Get Current User Profile

**Endpoint:** `GET /auth/me`

**Authentication:** Required - `Authorization: Bearer {token}`

**Description:** Get details of the currently authenticated user

**cURL Example:**
```bash
curl -X GET http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "user_12345",
    "name": "John Doe",
    "email": "john@example.com",
    "avatarUrl": "https://example.com/avatar.jpg",
    "documentsCount": 15,
    "queriesCount": 42,
    "createdAt": "2026-05-17T11:00:00.000Z",
    "updatedAt": "2026-05-17T12:30:00.000Z"
  }
}
```

---

## 5. Change Password

**Endpoint:** `PUT /auth/change-password`

**Authentication:** Required - `Authorization: Bearer {token}`

**Content-Type:** `application/json`

**Description:** Change the password for the current user account

**Request Body:**
```json
{
  "currentPassword": "SecurePassword123!",
  "newPassword": "NewSecurePassword456!"
}
```

**Validation Rules:**
- `currentPassword`: string (min: 1) - required
- `newPassword`: string (min: 8, max: 128) - required

**cURL Example:**
```bash
curl -X PUT http://localhost:3000/api/v1/auth/change-password \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "SecurePassword123!",
    "newPassword": "NewSecurePassword456!"
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Password updated successfully"
  }
}
```

---

## 6. Logout

**Endpoint:** `POST /auth/logout`

**Authentication:** Required - `Authorization: Bearer {token}`

**Content-Type:** `application/json`

**Description:** Logout from current session and invalidate current tokens

**Request Body (optional):**
```json
{
  "refreshToken": "refresh_token_xyz789..."
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "refresh_token_xyz789..."
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

---

## 7. Logout All Sessions

**Endpoint:** `POST /auth/logout-all`

**Authentication:** Required - `Authorization: Bearer {token}`

**Description:** Logout from all sessions and devices by invalidating all refresh tokens

**⚠️ WARNING:** This will log out the user from all devices

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/logout-all \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "All sessions terminated"
  }
}
```

---

## Error Responses

### 400 Invalid Credentials
```json
{
  "success": false,
  "code": "INVALID_CREDENTIALS",
  "message": "Invalid email or password",
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password"
  }
}
```

### 409 Email Already Exists
```json
{
  "success": false,
  "code": "EMAIL_ALREADY_EXISTS",
  "message": "Email already registered",
  "error": {
    "code": "EMAIL_ALREADY_EXISTS",
    "message": "Email already registered"
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
      "email": ["Invalid email"],
      "password": ["String must contain at least 8 character(s)"]
    }
  }
}
```

### 401 Unauthorized / Invalid Token
```json
{
  "success": false,
  "code": "UNAUTHORIZED",
  "message": "Invalid or expired token",
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  }
}
```

---

## Token Information

### Access Token
- **Format:** JWT (JSON Web Token)
- **Duration:** 1 hour (3600 seconds)
- **Usage:** Include in `Authorization: Bearer {token}` header for protected endpoints
- **Refresh:** Use refresh token to get a new access token when expired

### Refresh Token
- **Format:** Opaque token string
- **Duration:** Long-lived (typically 7-30 days)
- **Usage:** Only for `/auth/refresh` endpoint
- **Storage:** Store securely (httpOnly cookie recommended for web)

---

## Rate Limiting

Auth endpoints have rate limiting to prevent brute-force attacks:
- `POST /auth/register` - 5 requests per hour per IP
- `POST /auth/login` - 5 requests per hour per IP
- Other endpoints - No rate limit

---

## Best Practices

1. **Secure Storage**: Store refresh tokens securely (never in localStorage)
2. **Token Rotation**: Automatically refresh access tokens before expiration
3. **HTTPS Only**: Always use HTTPS in production
4. **Password Requirements**: Enforce strong passwords (min 8 chars)
5. **Session Management**: Provide logout-all option for security
6. **Email Verification**: Consider adding email verification before account activation (not currently implemented)

---

## Postman Setup

1. After login, automatically capture tokens:
```javascript
// Add to Tests tab of login request
pm.environment.set("token", pm.response.json().data.tokens.accessToken);
pm.environment.set("refreshToken", pm.response.json().data.tokens.refreshToken);
```

2. Use `{{token}}` in Authorization header for protected endpoints
