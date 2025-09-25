# Eidos - API Specification

> External API layer for partner integrations and programmatic access to the system.

## 1) API Philosophy

- **Stability First:** External APIs must be stable and versioned
- **Resource-Oriented:** RESTful design following HTTP semantics
- **Async-Aware:** Support for long-running operations via job patterns
- **Security-First:** OAuth2, rate limiting, and audit logging by default
- **Developer-Friendly:** Comprehensive docs, SDKs, and sandbox environment

## 2) Technology Approach

- **Framework:** RESTful API framework with OpenAPI support
- **Documentation:** Auto-generated from code annotations
- **Authentication:** OAuth2 with JWT tokens or API keys
- **Rate Limiting:** Token bucket or sliding window algorithm
- **Validation:** Schema-based request/response validation
- **Storage:** Database with connection pooling and caching

> See [Framework Guide](./FRAMEWORKS.md) for specific technology implementations.

## 3) Architecture

### 3.1) API Gateway Pattern
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   External   │────▶│   API Layer  │────▶│   Database   │
│   Clients    │◀────│  (Gateway)   │◀────│  (Supabase)  │
└──────────────┘     └──────────────┘     └──────────────┘
                            │                      ▲
                            ▼                      │
                     ┌──────────────┐              │
                     │   Commands   │──────────────┘
                     │   (Async)    │
                     └──────────────┘
```

### 3.2) Request Flow

1. **Client Request** → API Gateway
2. **Authentication** → Validate OAuth token
3. **Authorization** → Check scopes and permissions
4. **Rate Limiting** → Check and decrement quota
5. **Validation** → Validate request schema
6. **Processing:**
   - Sync: Direct database operation
   - Async: Create command, return job ID
7. **Response** → Format and return

## 4) Authentication & Authorization

### 4.1) OAuth2 Implementation

**Grant Types:**
- Client Credentials (service-to-service)
- Authorization Code (user delegation)
- Personal Access Tokens (developer tools)

**Token Structure:**
```json
{
  "sub": "client_id or user_id",
  "aud": "api.example.com",
  "iss": "auth.example.com",
  "exp": 1234567890,
  "iat": 1234567890,
  "scopes": ["read:projects", "write:projects"],
  "tenant_id": "org_123",
  "client_id": "app_456"
}
```

### 4.2) Scopes

**Resource Scopes:**
```
read:projects     - View projects
write:projects    - Create/update projects
delete:projects   - Delete projects
read:users        - View users
write:users       - Create/update users
admin:all         - Full access
```

**Action Scopes:**
```
execute:reports   - Generate reports
execute:imports   - Run imports
execute:exports   - Run exports
```

### 4.3) API Key Management

```python
class APIKey(BaseModel):
    id: str
    name: str
    key_prefix: str  # First 8 chars for identification
    hashed_key: str  # Full key is hashed
    scopes: List[str]
    tenant_id: str
    created_at: datetime
    last_used_at: Optional[datetime]
    expires_at: Optional[datetime]
    rate_limit: Optional[int]
```

## 5) Resource Design

### 5.1) URL Structure

```
https://api.example.com/v1/{resource}
https://api.example.com/v1/{resource}/{id}
https://api.example.com/v1/{resource}/{id}/{subresource}
```

Examples:
```
GET    /v1/projects              # List projects
POST   /v1/projects              # Create project
GET    /v1/projects/123          # Get project
PATCH  /v1/projects/123          # Update project
DELETE /v1/projects/123          # Delete project
GET    /v1/projects/123/tasks    # Get project tasks
POST   /v1/projects/123/tasks    # Add task to project
```

### 5.2) Request/Response Format

**Request:**
```http
POST /v1/projects HTTP/1.1
Host: api.example.com
Authorization: Bearer {token}
Content-Type: application/json
Idempotency-Key: proj-create-123

{
  "name": "New Project",
  "description": "Project description",
  "status": "active",
  "owner_id": "user_123"
}
```

**Response:**
```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /v1/projects/proj_456
X-Request-Id: req_789

{
  "id": "proj_456",
  "name": "New Project",
  "description": "Project description",
  "status": "active",
  "owner": {
    "id": "user_123",
    "name": "John Doe"
  },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z",
  "_links": {
    "self": "/v1/projects/proj_456",
    "tasks": "/v1/projects/proj_456/tasks",
    "members": "/v1/projects/proj_456/members"
  }
}
```

### 5.3) Partial Updates (PATCH)

Using JSON Patch (RFC 6902):
```json
PATCH /v1/projects/123
Content-Type: application/json-patch+json

[
  { "op": "replace", "path": "/status", "value": "completed" },
  { "op": "add", "path": "/tags/-", "value": "important" }
]
```

Or JSON Merge Patch (RFC 7396):
```json
PATCH /v1/projects/123
Content-Type: application/merge-patch+json

{
  "status": "completed",
  "description": "Updated description"
}
```

## 6) Pagination

### 6.1) Cursor-Based Pagination

**Request:**
```
GET /v1/projects?limit=20&cursor=eyJpZCI6MTIzfQ
```

**Response:**
```json
{
  "data": [...],
  "pagination": {
    "cursor": "eyJpZCI6MTQzfQ",
    "has_more": true,
    "total_count": 150
  },
  "_links": {
    "self": "/v1/projects?limit=20&cursor=eyJpZCI6MTIzfQ",
    "next": "/v1/projects?limit=20&cursor=eyJpZCI6MTQzfQ"
  }
}
```

### 6.2) Offset-Based Pagination (Alternative)

```
GET /v1/projects?page=2&per_page=20

{
  "data": [...],
  "pagination": {
    "page": 2,
    "per_page": 20,
    "total_pages": 8,
    "total_count": 150
  }
}
```

## 7) Filtering & Sorting

### 7.1) Filtering

**Simple Filters:**
```
GET /v1/projects?status=active
GET /v1/projects?owner_id=user_123
```

**Advanced Filters:**
```
GET /v1/projects?filter[status][eq]=active
GET /v1/projects?filter[created_at][gte]=2024-01-01
GET /v1/projects?filter[budget][between]=1000,5000
```

**Operators:**
- `eq` - equals
- `ne` - not equals
- `gt` - greater than
- `gte` - greater than or equal
- `lt` - less than
- `lte` - less than or equal
- `like` - pattern matching
- `in` - in list
- `between` - between two values

### 7.2) Sorting

```
GET /v1/projects?sort=created_at       # Ascending
GET /v1/projects?sort=-created_at      # Descending
GET /v1/projects?sort=status,-updated_at  # Multiple
```

### 7.3) Field Selection

```
GET /v1/projects?fields=id,name,status
GET /v1/projects?include=owner,tasks   # Include relations
```

## 8) Async Operations

### 8.1) Job Creation

**Request:**
```http
POST /v1/reports/generate HTTP/1.1
Content-Type: application/json

{
  "type": "monthly_summary",
  "parameters": {
    "month": "2024-01",
    "include_charts": true
  }
}
```

**Response:**
```http
HTTP/1.1 202 Accepted
Location: /v1/jobs/job_123
Content-Type: application/json

{
  "job_id": "job_123",
  "status": "pending",
  "created_at": "2024-01-01T00:00:00Z",
  "_links": {
    "self": "/v1/jobs/job_123",
    "cancel": "/v1/jobs/job_123/cancel"
  }
}
```

### 8.2) Job Status Polling

```http
GET /v1/jobs/job_123 HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json

{
  "job_id": "job_123",
  "status": "completed",
  "progress": 100,
  "result": {
    "report_url": "https://storage.example.com/reports/123.pdf"
  },
  "created_at": "2024-01-01T00:00:00Z",
  "started_at": "2024-01-01T00:00:05Z",
  "completed_at": "2024-01-01T00:01:00Z"
}
```

### 8.3) Server-Sent Events (Alternative)

```http
GET /v1/jobs/job_123/stream HTTP/1.1
Accept: text/event-stream

HTTP/1.1 200 OK
Content-Type: text/event-stream

event: progress
data: {"progress": 25, "message": "Processing data..."}

event: progress
data: {"progress": 50, "message": "Generating charts..."}

event: complete
data: {"status": "completed", "result": {...}}
```

## 9) Error Handling

### 9.1) Error Response Format (RFC 7807)

```json
{
  "type": "https://api.example.com/errors/validation",
  "title": "Validation Error",
  "status": 400,
  "detail": "The request payload failed validation",
  "instance": "/v1/projects",
  "trace_id": "trace_123",
  "errors": [
    {
      "field": "budget",
      "message": "Must be a positive number",
      "code": "MIN_VALUE"
    }
  ]
}
```

### 9.2) Standard Error Codes

| Status | Type | Description |
|--------|------|-------------|
| 400 | validation_error | Invalid request data |
| 401 | authentication_required | Missing or invalid auth |
| 403 | insufficient_permissions | Lacks required scope |
| 404 | resource_not_found | Entity doesn't exist |
| 409 | conflict | Duplicate or state conflict |
| 422 | business_rule_violation | Valid but unprocessable |
| 429 | rate_limit_exceeded | Too many requests |
| 500 | internal_server_error | Unexpected error |
| 503 | service_unavailable | Temporary outage |

## 10) Rate Limiting

### 10.1) Headers

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
X-RateLimit-Reset-After: 3600
X-RateLimit-Bucket: api_key_123
```

### 10.2) Rate Limit Response

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "type": "rate_limit_exceeded",
  "title": "Rate Limit Exceeded",
  "status": 429,
  "detail": "API rate limit of 1000 requests per hour exceeded",
  "retry_after": 60
}
```

### 10.3) Rate Limit Configuration

```python
RATE_LIMITS = {
    "default": {
        "requests": 1000,
        "window": 3600  # 1 hour
    },
    "authenticated": {
        "requests": 5000,
        "window": 3600
    },
    "premium": {
        "requests": 50000,
        "window": 3600
    }
}

# Per-endpoint overrides
ENDPOINT_LIMITS = {
    "POST /v1/reports/generate": {
        "requests": 10,
        "window": 3600
    }
}
```

## 11) Idempotency

### 11.1) Implementation

```python
async def handle_idempotent_request(
    idempotency_key: str,
    request: Request
) -> Response:
    # Check for existing result
    existing = await get_idempotency_record(idempotency_key)
    
    if existing:
        if existing.status == "processing":
            return Response(
                status_code=409,
                content={"error": "Request in progress"}
            )
        return existing.response
    
    # Store request
    await store_idempotency_record(
        key=idempotency_key,
        request_hash=hash_request(request),
        status="processing"
    )
    
    try:
        response = await process_request(request)
        await update_idempotency_record(
            key=idempotency_key,
            status="completed",
            response=response
        )
        return response
    except Exception as e:
        await update_idempotency_record(
            key=idempotency_key,
            status="failed",
            error=str(e)
        )
        raise
```

### 11.2) Storage Schema

```sql
CREATE TABLE idempotency_records (
    key VARCHAR(255) PRIMARY KEY,
    request_hash VARCHAR(64),
    response JSONB,
    status VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_idempotency_expires ON idempotency_records(expires_at);
```

## 12) Versioning

### 12.1) URL Versioning

```
https://api.example.com/v1/projects
https://api.example.com/v2/projects
```

### 12.2) Header Versioning (Alternative)

```http
GET /projects HTTP/1.1
Accept: application/vnd.example.v2+json
```

### 12.3) Deprecation

```http
HTTP/1.1 200 OK
Sunset: Sat, 31 Dec 2024 23:59:59 GMT
Deprecation: true
Link: <https://api.example.com/v2/projects>; rel="successor-version"
Warning: 299 - "This API version is deprecated and will be removed on 2024-12-31"
```

## 13) OpenAPI Specification

### 13.1) Metadata

```yaml
openapi: 3.0.0
info:
  title: Example API
  version: 1.0.0
  description: REST API for Example Application
  contact:
    email: api@example.com
  license:
    name: MIT
    
servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://sandbox.api.example.com/v1
    description: Sandbox
    
security:
  - bearerAuth: []
  - apiKey: []
```

### 13.2) Endpoint Definition

```yaml
paths:
  /projects:
    get:
      summary: List projects
      operationId: listProjects
      tags:
        - Projects
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [active, completed, archived]
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
            maximum: 100
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Project'
                  pagination:
                    $ref: '#/components/schemas/Pagination'
```

### 13.3) Schema Generation

```yaml
# Example OpenAPI configuration
openapi: 3.0.0
info:
  title: Example API
  version: 1.0.0
  description: REST API for Example Application
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
security:
  - bearerAuth: []
  - apiKey: []
```

## 14) SDK Generation

### 14.1) TypeScript SDK

```typescript
// Generated from OpenAPI spec
export class ExampleAPI {
  private baseUrl: string;
  private apiKey: string;
  
  constructor(config: APIConfig) {
    this.baseUrl = config.baseUrl || 'https://api.example.com/v1';
    this.apiKey = config.apiKey;
  }
  
  async listProjects(params?: ListProjectsParams): Promise<ProjectList> {
    const response = await fetch(`${this.baseUrl}/projects`, {
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new APIError(await response.json());
    }
    
    return response.json();
  }
}
```

### 14.2) Python SDK

```javascript
// Generated SDK example
class ExampleAPI {
  constructor(apiKey, baseUrl = 'https://api.example.com/v1') {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.headers = {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    };
  }

  async listProjects({ status, limit = 20 } = {}) {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', limit.toString());

    const response = await fetch(`${this.baseUrl}/projects?${params}`, {
      headers: this.headers
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }
}
```

## 15) Testing

### 15.1) Integration Tests

```python
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_create_project():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/v1/projects",
            json={
                "name": "Test Project",
                "status": "active"
            },
            headers={
                "Authorization": "Bearer test-token",
                "Idempotency-Key": "test-123"
            }
        )
        
        assert response.status_code == 201
        assert response.json()["name"] == "Test Project"
        assert "Location" in response.headers
```

### 15.2) Contract Tests

```python
# Verify API matches OpenAPI spec
from openapi_spec_validator import validate_spec
from jsonschema import validate

def test_openapi_spec_valid():
    spec = load_openapi_spec()
    validate_spec(spec)

def test_response_matches_schema():
    response = make_api_call("/v1/projects")
    schema = load_schema("ProjectList")
    validate(response.json(), schema)
```

### 15.3) Load Tests

```python
# Using locust
from locust import HttpUser, task, between

class APIUser(HttpUser):
    wait_time = between(1, 3)
    
    def on_start(self):
        self.client.headers = {
            "Authorization": f"Bearer {get_token()}"
        }
    
    @task(3)
    def list_projects(self):
        self.client.get("/v1/projects")
    
    @task(1)
    def create_project(self):
        self.client.post(
            "/v1/projects",
            json={"name": f"Project {uuid4()}", "status": "active"}
        )
```

## 16) Security

### 16.1) HTTPS Only

```python
# Enforce HTTPS in production
@app.middleware("http")
async def enforce_https(request: Request, call_next):
    if not request.url.scheme == "https" and not settings.DEBUG:
        return Response(
            status_code=403,
            content={"error": "HTTPS required"}
        )
    return await call_next(request)
```

### 16.2) CORS Configuration

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-*", "X-Request-Id"],
)
```

### 16.3) Input Sanitization

```python
from bleach import clean

def sanitize_input(data: dict) -> dict:
    """Sanitize user input to prevent XSS"""
    sanitized = {}
    for key, value in data.items():
        if isinstance(value, str):
            sanitized[key] = clean(value, strip=True)
        else:
            sanitized[key] = value
    return sanitized
```

## 17) Monitoring

### 17.1) Metrics

```python
from prometheus_client import Counter, Histogram

api_requests = Counter(
    'api_requests_total',
    'Total API requests',
    ['method', 'endpoint', 'status']
)

api_latency = Histogram(
    'api_latency_seconds',
    'API latency',
    ['method', 'endpoint']
)

@app.middleware("http")
async def track_metrics(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    
    api_requests.labels(
        method=request.method,
        endpoint=request.url.path,
        status=response.status_code
    ).inc()
    
    api_latency.labels(
        method=request.method,
        endpoint=request.url.path
    ).observe(time.time() - start)
    
    return response
```

### 17.2) Logging

```python
@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = str(uuid4())
    
    # Add to context
    request.state.request_id = request_id
    
    # Log request
    logger.info(
        "api.request",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        client_ip=request.client.host,
        user_agent=request.headers.get("user-agent")
    )
    
    # Process
    response = await call_next(request)
    
    # Log response
    logger.info(
        "api.response",
        request_id=request_id,
        status_code=response.status_code,
        duration=time.time() - start
    )
    
    # Add header
    response.headers["X-Request-Id"] = request_id
    return response
```

## 18) Documentation

### 18.1) API Documentation Site

```markdown
# API Documentation

Base URL: `https://api.example.com/v1`

## Authentication

All requests require authentication via Bearer token or API key.

### Bearer Token
```http
Authorization: Bearer {token}
```

### API Key
```http
X-API-Key: {api_key}
```

## Rate Limiting

- Default: 1000 requests/hour
- Authenticated: 5000 requests/hour
- Premium: 50000 requests/hour

## Endpoints

### Projects

#### List Projects
`GET /projects`

Parameters:
- `status` (string): Filter by status
- `limit` (integer): Results per page (max 100)
- `cursor` (string): Pagination cursor

Response:
```json
{
  "data": [...],
  "pagination": {...}
}
```
```

### 18.2) Interactive Documentation

- Swagger UI at `/docs`
- ReDoc at `/redoc`
- Postman collection export
- Example requests in multiple languages

## 19) Checklist

### Core Functionality
- [ ] RESTful resource endpoints implemented
- [ ] CRUD operations for all entities
- [ ] Pagination (cursor-based)
- [ ] Filtering and sorting
- [ ] Field selection and includes

### Async Operations
- [ ] Job creation endpoints
- [ ] Job status polling
- [ ] Job cancellation
- [ ] SSE/WebSocket support (optional)

### Security
- [ ] OAuth2 implementation
- [ ] API key management
- [ ] Rate limiting
- [ ] CORS configuration
- [ ] HTTPS enforcement
- [ ] Input sanitization

### Reliability
- [ ] Idempotency support
- [ ] Error handling (RFC 7807)
- [ ] Request/response validation
- [ ] Retry guidance in docs

### Documentation
- [ ] OpenAPI specification
- [ ] Interactive documentation
- [ ] Authentication guide
- [ ] Rate limit documentation
- [ ] Error code reference
- [ ] Example requests

### SDKs
- [ ] TypeScript SDK generated
- [ ] Python SDK generated
- [ ] SDK documentation
- [ ] SDK examples

### Testing
- [ ] Integration tests
- [ ] Contract tests
- [ ] Load tests
- [ ] Security tests

### Monitoring
- [ ] Request/response logging
- [ ] Metrics collection
- [ ] Error tracking
- [ ] Performance monitoring
- [ ] Audit logging

### Versioning
- [ ] Version strategy defined
- [ ] Deprecation policy
- [ ] Migration guides
- [ ] Backward compatibility