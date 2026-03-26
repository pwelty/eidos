# Eidos - Foundations Specification

> Cross-cutting concerns: testing, observability, security, configuration, and error handling patterns for all components.

## 1) Core Philosophy

- **Testable by Design:** TDD for business logic, comprehensive test coverage
- **Observable from Day One:** Logging, tracing, and metrics built-in

## 2) Supabase client types

**This is the single most common source of silent failures.** Three contexts, three factories — using the wrong one silently fails (wrong auth, wrong RLS, cookie mutation errors).

| Context | Factory | Key | Cookies | RLS |
|---------|---------|-----|---------|-----|
| Server components / actions | `createServerClient()` | Anon | Yes (read) | Enforced |
| Browser / client components | `getSupabaseBrowserClient()` | Anon | Yes (read+write) | Enforced |
| API routes / admin operations | `createAdminClient()` | Service role | No | Bypassed |

```
lib/supabase/
  server.ts    — SSR client, needs await cookies(), setAll must silently catch errors
  client.ts    — browser singleton (one instance, not re-created per call)
  admin.ts     — service role, server-only, never import in client components
  middleware.ts — request-scoped, can mutate cookies
```

```typescript
// server.ts — must silently catch cookie errors (server components can't set cookies)
export async function createServerClient() {
  const cookieStore = await cookies()
  return createSupabaseServerClient(URL, ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options))
        } catch { /* silently ignore — server components can't set cookies */ }
      },
    },
  })
}
```

> **CRITICAL:** The admin client bypasses RLS entirely. Never use it for user-facing queries. Never import it in client components (the service role key would be exposed).

## 3) Admin interface pattern

### createAdminClient() helper

Admin pages need cross-workspace visibility, which RLS blocks by design. Use the service role client only after verifying admin status with the regular (RLS-enforced) client.

```typescript
// lib/supabase/admin.ts
import { createClient } from "@supabase/supabase-js"
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
```

### Admin guard via layout.tsx

Gate admin routes with a layout that checks `user_profiles.admin = true`. Return `notFound()` for non-admins — no information leak, looks like a 404.

```typescript
// app/(app)/admin/layout.tsx
export default async function AdminLayout({ children }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()
  const { data: profile } = await supabase
    .from("user_profiles").select("admin").eq("id", user.id).single()
  if (!profile?.admin) notFound()
  return <>{children}</>
}
```

### Admin server actions must re-verify

Every admin server action must independently verify `admin = true`. The layout guard only runs on page load — server actions can be called directly from any client.

```typescript
export async function adminOnlyAction() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  const { data: profile } = await supabase
    .from("user_profiles").select("admin").eq("id", user.id).single()
  if (!profile?.admin) return { error: "Forbidden" }
  // ... admin logic using createAdminClient()
}
```

## 3b) Multi-tenant workspace isolation with service-role clients

When using a service-role Supabase client (which bypasses RLS), you must enforce workspace isolation manually in every query. RLS is your safety net for normal user sessions — but it does nothing for service-role. Without explicit filtering, any valid request can read or modify any workspace's data.

**Thread `workspaceId` through every helper — even internal ones:**

```typescript
// WRONG: filters by id only — any workspace can read any content
async function fetchContent(supabase: Supabase, contentId: string) {
  return supabase.from("contents").select("*").eq("id", contentId).single()
}

// RIGHT: always add workspace_id constraint
async function fetchContent(supabase: Supabase, contentId: string, workspaceId: string) {
  return supabase
    .from("contents")
    .select("*")
    .eq("id", contentId)
    .eq("workspace_id", workspaceId)
    .single()
}
```

This applies to **every** DB helper — fetch, update, delete — regardless of how "internal" it feels. The workspace constraint is what makes cross-workspace data leakage impossible even if a bug in the caller passes the wrong ID.

> **Pattern:** Every public-facing pipeline function signature should be `(supabase, entityId, workspaceId, ...rest)`. If a function doesn't take `workspaceId`, that's a red flag.

## 4) Testing Strategies

### 2.1) Test Database Setup

```javascript
// Example test database setup - adapt to your framework
const testDb = {
  async setup() {
    // Use test containers or in-memory database
    this.container = await new PostgreSQLContainer().start();
    this.connection = await createConnection(this.container.getConnectionUri());

    // Run migrations
    await runMigrations(this.connection);

    // Seed test data
    await seedTestData(this.connection);

    return this.connection;
  },

  async cleanup() {
    await this.connection?.close();
    await this.container?.stop();
  },

  async withTransaction(testFn) {
    const tx = await this.connection.beginTransaction();
    try {
      await testFn(tx);
    } finally {
      await tx.rollback();
    }
  }
};
```

### 2.2) Database Tests

```javascript
test('soft delete cascade', async () => {
  // Create parent and children
  const project = await createProject({ name: 'Test Project' });
  const task1 = await createTask({ projectId: project.id });
  const task2 = await createTask({ projectId: project.id });

  // Soft delete parent
  await softDelete(project);

  // Verify children are also soft deleted
  const updatedTask1 = await getTask(task1.id);
  const updatedTask2 = await getTask(task2.id);
  expect(updatedTask1.deletedAt).toBeTruthy();
  expect(updatedTask2.deletedAt).toBeTruthy();
});

test('unique constraint violation', async () => {
  // Create user with email
  await createUser({ email: 'test@example.com' });

  // Try to create another with same email
  await expect(
    createUser({ email: 'test@example.com' })
  ).rejects.toThrow('unique constraint');
});

test('tenant isolation policy', async () => {
  // Set tenant context
  setTenantId('tenant_1');
  const project1 = await createProject({ tenantId: 'tenant_1' });

  // Switch tenant
  setTenantId('tenant_2');
  const project2 = await createProject({ tenantId: 'tenant_2' });

  // Verify isolation
  const visibleProjects = await getVisibleProjects();
  expect(visibleProjects).not.toContain(project1);
  expect(visibleProjects).toContain(project2);
});
```

### 2.3) Integration Tests

```python
@pytest.mark.integration
async def test_full_workflow():
    # Create project
    project = await api.create_project({
        "name": "Test Project",
        "status": "active"
    })

    # Add tasks
    task1 = await api.create_task({
        "project_id": project.id,
        "name": "Task 1"
    })

    # Add members
    await api.add_project_member({
        "project_id": project.id,
        "user_id": "user_123",
        "role": "developer"
    })

    # Generate report (async)
    job = await api.generate_report({
        "project_id": project.id,
        "type": "summary"
    })

    # Wait for completion
    result = await wait_for_job(job.id)

    # Verify report
    assert result.status == "completed"
    assert result.data["task_count"] == 1
    assert result.data["member_count"] == 1
```

### 2.4) Node native test runner for TypeScript helpers

For pure logic tests (no DOM, no framework), skip Jest/Vitest. Node's built-in `node:test` + `--experimental-strip-types` is zero-config and fast.

**Pattern:** `.mjs` test files with explicit `.ts` extension imports.

```javascript
// web/lib/__tests__/my-helper.test.mjs
import assert from "node:assert/strict"
import test from "node:test"
import { myHelper } from "../my-helper.ts"  // explicit .ts extension required

test("description", () => {
  assert.equal(myHelper("input"), "expected")
})

test("async case", async () => {
  await assert.rejects(() => myHelper(null), /error message/)
})
```

Run with:
```bash
node --experimental-strip-types --test lib/__tests__/my-helper.test.mjs
```

> **Why `.mjs`?** TypeScript compiler ignores `.mjs` files, so you don't need `allowImportingTsExtensions` in tsconfig. The `.ts` extension in the import tells Node to strip types at load time.

## 5) Observability

### 3.1) Logging Standards

**Log Levels:**
- **ERROR:** System errors, exceptions, failures
- **WARN:** Degraded performance, retry-able errors
- **INFO:** State changes, business events
- **DEBUG:** Detailed execution flow

**Log Structure:**
```json
{
  "timestamp": "2024-01-01T00:00:00Z",
  "level": "INFO",
  "service": "api",
  "environment": "production",
  "trace_id": "abc123",
  "span_id": "def456",
  "request_id": "req_789",
  "user_id": "user_123",
  "tenant_id": "tenant_456",
  "message": "Project created",
  "data": {
    "project_id": "proj_789",
    "name": "New Project"
  }
}
```

### 3.2) Tracing

**Trace Structure:**
```
API Request (trace root)
├── Authenticate (span)
├── Validate Request (span)
├── Database Query (span)
│   ├── Connection Pool (span)
│   └── Execute SQL (span)
├── Business Logic (span)
│   ├── Calculate Budget (span)
│   └── Send Notification (span)
└── Format Response (span)
```

**Implementation:**
```javascript
// Example using OpenTelemetry - adapt to your tracing library
const { trace } = require('@opentelemetry/api');
const tracer = trace.getTracer('my-service');

function processRequest(request) {
  return tracer.startActiveSpan('process_request', (span) => {
    span.setAttributes({
      'request.id': request.id,
      'request.method': request.method
    });

    try {
      // Nested spans
      tracer.startActiveSpan('validate', () => {
        validateRequest(request);
      });

      const result = tracer.startActiveSpan('database', () => {
        return queryDatabase(request);
      });

      span.setStatus({ code: trace.SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({
        code: trace.SpanStatusCode.ERROR,
        message: error.message
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### 3.3) Metrics

**Standard Metrics:**
```python
# Request metrics
http_requests_total{method, endpoint, status}
http_request_duration_seconds{method, endpoint}

# Business metrics
entities_created_total{entity_type}
commands_processed_total{command_type, status}
jobs_duration_seconds{job_type}

# System metrics
database_connections_active
database_query_duration_seconds{query_type}
cache_hit_ratio
```

### 3.4) Health Checks

```python
async def health_check():
    checks = {
        "database": check_database(),
        "redis": check_redis(),
        "disk_space": check_disk_space(),
        "memory": check_memory()
    }

    status = "healthy" if all(checks.values()) else "unhealthy"

    return {
        "status": status,
        "checks": checks,
        "timestamp": datetime.utcnow(),
        "version": APP_VERSION
    }

# Readiness check
async def readiness_check():
    return {
        "ready": await is_ready(),
        "dependencies": {
            "database": await db_ready(),
            "cache": await cache_ready()
        }
    }
```

## 6) Security Patterns

### 4.1) Authentication & Session Management

```python
# Session configuration
SESSION_CONFIG = {
    "secret_key": env("SESSION_SECRET"),
    "algorithm": "HS256",
    "access_token_ttl": 900,  # 15 minutes
    "refresh_token_ttl": 604800,  # 7 days
    "secure": True,  # HTTPS only
    "httponly": True,  # No JS access
    "samesite": "lax"  # CSRF protection
}

# Token structure
{
    "sub": "user_123",
    "tenant": "tenant_456",
    "roles": ["admin", "user"],
    "exp": 1234567890,
    "iat": 1234567890,
    "jti": "token_unique_id"  # For revocation
}
```

### 4.2) Input Validation

```python
from pydantic import BaseModel, validator, constr, EmailStr

class CreateProjectInput(BaseModel):
    name: constr(min_length=1, max_length=255)
    description: Optional[str]
    status: Literal["active", "on_hold", "completed"]
    budget: Decimal = Field(gt=0, decimal_places=2)
    owner_email: EmailStr

    @validator("name")
    def validate_name(cls, v):
        if not v or v.isspace():
            raise ValueError("Name cannot be empty")
        return v.strip()

    @validator("description")
    def sanitize_description(cls, v):
        if v:
            # Remove dangerous HTML/scripts
            return bleach.clean(v, strip=True)
        return v
```

## 7) Configuration Management

### 5.1) Environment-Based Config

```python
from pydantic import BaseSettings

class Settings(BaseSettings):
    # Application
    app_name: str = "Example App"
    environment: str = "development"
    debug: bool = False

    # Database
    database_url: str
    database_pool_size: int = 20

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Security
    secret_key: str
    jwt_algorithm: str = "HS256"
    cors_origins: List[str] = []

    # External services
    smtp_host: str
    smtp_port: int = 587
    sentry_dsn: Optional[str] = None

    # Feature flags
    enable_async_processing: bool = True
    enable_rate_limiting: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
```

### 5.2) Feature Flags

```python
class FeatureFlags:
    def __init__(self, store: redis.Redis):
        self.store = store

    def is_enabled(
        self,
        feature: str,
        user_id: str = None,
        tenant_id: str = None
    ) -> bool:
        # Global flag
        if self.store.get(f"flag:{feature}:global") == "true":
            return True

        # Tenant flag
        if tenant_id and self.store.get(f"flag:{feature}:tenant:{tenant_id}") == "true":
            return True

        # User flag
        if user_id and self.store.get(f"flag:{feature}:user:{user_id}") == "true":
            return True

        # Percentage rollout
        percentage = self.store.get(f"flag:{feature}:percentage")
        if percentage and user_id:
            return hash(user_id) % 100 < int(percentage)

        return False
```

## 8) Error Handling

### 6.0) Supabase-specific: PGRST116 (row not found)

When using Supabase with `.single()`, the `PGRST116` error code means "no rows matched" — a normal, expected state for many queries. Treat it as a domain `NotFound`, not an unexpected DB error. All other error codes are unexpected and warrant Sentry capture + 500 response.

```typescript
const PGRST116 = "PGRST116" // Row not found (PostgREST)

const { data, error } = await admin
  .from("webauthn_challenges")
  .select("id, challenge")
  .eq("id", challengeId)
  .single()

if (error) {
  if (error.code === PGRST116) {
    return NextResponse.json({ error: "Not found" }, { status: 400 })  // expected
  }
  Sentry.captureException(error)
  return NextResponse.json({ error: "Internal server error" }, { status: 500 })  // unexpected
}
```

### 6.0b) Server actions must fail loudly on DB errors

Server actions that query data must never silently return `null` or empty data on DB errors. Silent failures appear as mysterious empty UI states with no user feedback and no server trace.

Pattern: check `res.error` after every Supabase query. If unexpected, capture to Sentry and return a structured `{ error }` so the caller can display it.

```typescript
const { data: profile, error } = await supabase
  .from("user_profiles").select("*").eq("id", user.id).single()

if (error) {
  Sentry.captureException(new Error(`getSettings failed: ${error.message}`), {
    extra: { userId: user.id, code: error.code },
  })
  return { error: "Failed to load settings. Please try again.", data: null }
}
```

### 6.0c) Admin guard for destructive server actions

Any server action that performs an irreversible operation (delete account, bulk delete, data mutation with no undo) must check whether an admin is currently impersonating a user. Without this guard, an admin could accidentally execute the action against a real user's account.

Detection: the impersonated user object carries a `_realAdminId` property on the server that is absent for real users.

```typescript
const user = await getUser()
if (!user) return { error: "Not authenticated" }

if ("_realAdminId" in user) {
  return { error: "Stop impersonating before performing account actions." }
}
```

UI-level hiding (not rendering the button) is insufficient — server actions can be called directly. The layout guard (admin layout returning 404 for non-admins) is also insufficient — it only runs on page load.

### 6.1) Error Hierarchy

```python
class AppError(Exception):
    """Base application error"""
    def __init__(self, message: str, code: str = None):
        self.message = message
        self.code = code or self.__class__.__name__
        super().__init__(message)

class ValidationError(AppError):
    """Invalid input data"""
    pass

class NotFoundError(AppError):
    """Resource not found"""
    pass

class PermissionError(AppError):
    """Insufficient permissions"""
    pass

class BusinessRuleError(AppError):
    """Business rule violation"""
    pass

class ExternalServiceError(AppError):
    """External service failure"""
    def __init__(self, message: str, service: str, retry_after: int = None):
        super().__init__(message)
        self.service = service
        self.retry_after = retry_after
```

### 6.2) Error Recovery

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=10),
    reraise=True
)
async def call_external_service(data):
    try:
        response = await http_client.post(SERVICE_URL, json=data)
        response.raise_for_status()
        return response.json()
    except httpx.TimeoutError:
        raise ExternalServiceError(
            "Service timeout",
            service="external_api",
            retry_after=60
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            retry_after = int(e.response.headers.get("Retry-After", 60))
            raise ExternalServiceError(
                "Rate limited",
                service="external_api",
                retry_after=retry_after
            )
        raise
```

## 9) Checklists

### Security Checklist
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (output encoding)
- [ ] CSRF protection enabled
- [ ] Rate limiting configured
- [ ] Secrets in secure storage
- [ ] HTTPS enforced in production
- [ ] Security headers configured

### Testing Checklist
- [ ] Unit tests for business logic
- [ ] Integration tests for workflows
- [ ] Database constraint tests
- [ ] RLS policy tests
- [ ] API contract tests
- [ ] Load tests performed
- [ ] Error handling tests
- [ ] Security tests (auth, injection)

### Observability Checklist
- [ ] Structured logging implemented
- [ ] Trace IDs propagated
- [ ] Key metrics identified and tracked
- [ ] Health checks implemented
- [ ] Error tracking configured
- [ ] Performance monitoring setup
- [ ] Alerting rules defined
- [ ] Dashboards created