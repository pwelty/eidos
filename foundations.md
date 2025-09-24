# Eidos - Foundations Specification

> Cross-cutting concerns: testing, observability, security, configuration, and error handling patterns for all components.

## 1) Core Philosophy

- **Testable by Design:** TDD for business logic, comprehensive test coverage
- **Observable from Day One:** Logging, tracing, and metrics built-in

## 2) Testing Strategies

### 2.1) Test Database Setup

```python
import pytest
from sqlalchemy import create_engine
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="session")
def db():
    with PostgresContainer("postgres:15") as postgres:
        engine = create_engine(postgres.get_connection_url())

        # Run migrations
        run_migrations(engine)

        # Seed test data
        seed_test_data(engine)

        yield engine

@pytest.fixture
def session(db):
    connection = db.connect()
    transaction = connection.begin()

    yield connection

    transaction.rollback()
    connection.close()
```

### 2.2) Database Tests

```python
def test_soft_delete_cascade():
    # Create parent and children
    project = create_project(name="Test Project")
    task1 = create_task(project_id=project.id)
    task2 = create_task(project_id=project.id)

    # Soft delete parent
    soft_delete(project)

    # Verify children are also soft deleted
    assert task1.deleted_at is not None
    assert task2.deleted_at is not None

def test_unique_constraint():
    # Create user with email
    create_user(email="test@example.com")

    # Try to create another with same email
    with pytest.raises(IntegrityError) as exc:
        create_user(email="test@example.com")

    assert "unique constraint" in str(exc.value)

def test_rls_policy():
    # Set tenant context
    set_tenant_id("tenant_1")
    project1 = create_project(tenant_id="tenant_1")

    # Switch tenant
    set_tenant_id("tenant_2")
    project2 = create_project(tenant_id="tenant_2")

    # Verify isolation
    visible_projects = get_visible_projects()
    assert project1 not in visible_projects
    assert project2 in visible_projects
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

## 3) Observability

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
```python
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

@tracer.start_as_current_span("process_request")
def process_request(request):
    span = trace.get_current_span()
    span.set_attribute("request.id", request.id)
    span.set_attribute("request.method", request.method)

    with tracer.start_as_current_span("validate"):
        validate_request(request)

    with tracer.start_as_current_span("database"):
        result = query_database(request)

    return result
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

## 4) Security Patterns

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

## 5) Configuration Management

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

## 6) Error Handling

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

## 7) Checklists

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