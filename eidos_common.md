# Eidos - Common Specification

> Shared patterns, database design, testing strategies, and observability for all components.

## 1) Core Philosophy

- **Database-First:** Model the real world in the database first; everything else follows
- **Convention Over Configuration:** Consistent patterns reduce cognitive load
- **Relationships Matter:** Treat important joins as first-class entities
- **Everything is Audited:** Who did what, when, and why
- **Testable by Design:** TDD for business logic, comprehensive test coverage
- **Observable from Day One:** Logging, tracing, and metrics built-in

## 2) Database Design

### 2.1) Standard Table Structure

**Required Columns (all tables):**
```sql
CREATE TABLE entity_name (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_id UUID REFERENCES users(id),
    updated_by_id UUID REFERENCES users(id),
    
    -- Multi-tenancy (if applicable)
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    
    -- Soft delete (optional)
    deleted_at TIMESTAMPTZ,
    deleted_by_id UUID REFERENCES users(id),
    
    -- Versioning (optional)
    version INTEGER NOT NULL DEFAULT 1,
    
    -- Entity-specific columns
    ...
);

-- Standard indexes
CREATE INDEX idx_entity_tenant ON entity_name(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_entity_created ON entity_name(created_at);
CREATE INDEX idx_entity_updated ON entity_name(updated_at);
CREATE INDEX idx_entity_deleted ON entity_name(deleted_at) WHERE deleted_at IS NOT NULL;
```

### 2.2) Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Tables | Singular, PascalCase | `Project`, `User`, `Invoice` |
| Columns | snake_case | `first_name`, `due_date` |
| Primary Keys | `id` | `id` |
| Foreign Keys | `{table}_id` | `project_id`, `user_id` |
| Indexes | `idx_{table}_{column(s)}` | `idx_project_status` |
| Constraints | `{table}_{type}_{detail}` | `project_check_dates` |
| Join Tables (attributed) | Semantic name | `ProjectMember`, `Enrollment` |
| Join Tables (simple) | `{table1}_{table2}_links` | `user_role_links` |

### 2.3) Data Types

**Preferred Types:**
- **IDs:** UUID (better for distributed systems)
- **Text:** TEXT (no artificial limits)
- **Numbers:** BIGINT for counts, DECIMAL for money
- **Dates:** TIMESTAMPTZ (always with timezone)
- **Status:** ENUM or VARCHAR with CHECK constraint
- **JSON:** JSONB (for flexible structured data)
- **Money:** DECIMAL(19,4) or separate cents column

**Avoid:**
- SERIAL (use UUID instead)
- TIMESTAMP without timezone
- FLOAT/REAL for money
- CHAR (use VARCHAR or TEXT)

### 2.4) Relationships

**One-to-Many:**
```sql
-- Parent
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL
);

-- Child (holds foreign key)
CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL
);
```

**Many-to-Many (Simple):**
```sql
CREATE TABLE user_role_links (
    user_id UUID REFERENCES users(id),
    role_id UUID REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
);
```

**Many-to-Many (Attributed - First-Class Entity):**
```sql
CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id),
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(50) NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, user_id, joined_at)
);
```

### 2.5) Constraints

**Common Constraints:**
```sql
-- Not null for required fields
ALTER TABLE projects ADD CONSTRAINT projects_name_required 
    CHECK (name IS NOT NULL AND name != '');

-- Unique constraints
ALTER TABLE users ADD CONSTRAINT users_email_unique 
    UNIQUE (email) WHERE deleted_at IS NULL;

-- Check constraints for business rules
ALTER TABLE projects ADD CONSTRAINT projects_dates_valid 
    CHECK (end_date >= start_date);

-- Enum-style constraints
ALTER TABLE tasks ADD CONSTRAINT tasks_status_valid 
    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

-- Positive numbers
ALTER TABLE invoices ADD CONSTRAINT invoices_amount_positive 
    CHECK (amount > 0);
```

### 2.6) Indexes

**Index Strategy:**
```sql
-- Foreign keys (always)
CREATE INDEX idx_tasks_project ON tasks(project_id);

-- Unique constraints that allow nulls
CREATE UNIQUE INDEX idx_users_email ON users(email) 
    WHERE email IS NOT NULL AND deleted_at IS NULL;

-- Common query patterns
CREATE INDEX idx_tasks_status_project ON tasks(status, project_id) 
    WHERE deleted_at IS NULL;

-- Sorting needs
CREATE INDEX idx_projects_updated ON projects(updated_at DESC);

-- Full-text search
CREATE INDEX idx_projects_search ON projects 
    USING gin(to_tsvector('english', name || ' ' || description));

-- JSONB queries
CREATE INDEX idx_tasks_metadata ON tasks 
    USING gin(metadata);
```

### 2.7) Views & Materialized Views

**Summary Views:**
```sql
CREATE VIEW project_summary AS
SELECT 
    p.id,
    p.name,
    p.status,
    COUNT(DISTINCT t.id) as task_count,
    COUNT(DISTINCT pm.user_id) as member_count,
    MAX(t.updated_at) as last_activity
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id
LEFT JOIN project_members pm ON pm.project_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY p.id;
```

**Materialized Views for Performance:**
```sql
CREATE MATERIALIZED VIEW user_statistics AS
SELECT 
    u.id,
    u.name,
    COUNT(DISTINCT p.id) as project_count,
    COUNT(DISTINCT t.id) as task_count,
    AVG(t.completion_time) as avg_task_time
FROM users u
LEFT JOIN project_members pm ON pm.user_id = u.id
LEFT JOIN projects p ON p.id = pm.project_id
LEFT JOIN tasks t ON t.assignee_id = u.id
GROUP BY u.id;

-- Refresh strategy
CREATE INDEX idx_user_statistics_id ON user_statistics(id);
REFRESH MATERIALIZED VIEW CONCURRENTLY user_statistics;
```

## 3) Row-Level Security (Supabase)

### 3.1) Basic RLS Policies

```sql
-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- View own tenant's data
CREATE POLICY "View own tenant projects" ON projects
    FOR SELECT
    USING (tenant_id = current_tenant_id());

-- Create in own tenant
CREATE POLICY "Create in own tenant" ON projects
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id());

-- Update own tenant's data
CREATE POLICY "Update own tenant projects" ON projects
    FOR UPDATE
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- Delete with permission
CREATE POLICY "Delete with permission" ON projects
    FOR DELETE
    USING (
        tenant_id = current_tenant_id() 
        AND has_permission('delete:projects')
    );
```

### 3.2) Helper Functions

```sql
-- Get current tenant
CREATE FUNCTION current_tenant_id() 
RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.current_tenant_id')::UUID;
EXCEPTION
    WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check permission
CREATE FUNCTION has_permission(permission TEXT) 
RETURNS BOOLEAN AS $$
DECLARE
    user_permissions TEXT[];
BEGIN
    SELECT permissions INTO user_permissions
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid();
    
    RETURN permission = ANY(user_permissions);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## 4) Migrations

### 4.1) Migration Structure

```sql
-- migrations/001_create_projects.up.sql
BEGIN;

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_created ON projects(created_at);

COMMIT;

-- migrations/001_create_projects.down.sql
BEGIN;
DROP TABLE IF EXISTS projects CASCADE;
COMMIT;
```

### 4.2) Migration Best Practices

```sql
-- Always use transactions
BEGIN;

-- Make migrations idempotent
CREATE TABLE IF NOT EXISTS ...
DROP TABLE IF EXISTS ...
CREATE INDEX IF NOT EXISTS ...

-- Add columns safely
ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS budget DECIMAL(19,4);

-- Provide defaults for NOT NULL columns
ALTER TABLE projects 
ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'active';

-- Rename safely
ALTER TABLE projects 
RENAME COLUMN IF EXISTS old_name TO new_name;

-- Add constraints with names
ALTER TABLE projects 
ADD CONSTRAINT projects_budget_positive 
CHECK (budget >= 0);

COMMIT;
```

## 5) Testing Strategies

### 5.1) Test Database Setup

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

### 5.2) Database Tests

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

### 5.3) Integration Tests

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

## 6) Observability

### 6.1) Logging Standards

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

### 6.2) Tracing

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

### 6.3) Metrics

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

### 6.4) Health Checks

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

## 7) Security Patterns

### 7.1) Authentication & Session Management

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

### 7.2) Input Validation

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

### 7.3) SQL Injection Prevention

```python
# NEVER do this
query = f"SELECT * FROM users WHERE email = '{email}'"

# Use parameterized queries
query = "SELECT * FROM users WHERE email = $1"
result = await db.fetch(query, email)

# With SQLAlchemy
from sqlalchemy import text

query = text("SELECT * FROM users WHERE email = :email")
result = conn.execute(query, {"email": email})

# Query builder
from sqlalchemy import select

stmt = select(User).where(User.email == email)
result = await session.execute(stmt)
```

## 8) Performance Patterns

### 8.1) N+1 Query Prevention

```python
# Bad - N+1 queries
projects = get_projects()
for project in projects:
    project.tasks = get_tasks(project.id)  # Query per project

# Good - Eager loading
projects = (
    session.query(Project)
    .options(joinedload(Project.tasks))
    .all()
)

# Good - Batch loading
project_ids = [p.id for p in projects]
tasks = get_tasks_by_project_ids(project_ids)
tasks_by_project = group_by(tasks, "project_id")
```

### 8.2) Database Connection Pooling

```python
from sqlalchemy.pool import NullPool, QueuePool

# Development - no pooling
engine = create_engine(
    DATABASE_URL,
    poolclass=NullPool
)

# Production - connection pool
engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=20,
    max_overflow=40,
    pool_timeout=30,
    pool_recycle=1800,  # Recycle connections after 30 min
    pool_pre_ping=True  # Verify connections before use
)
```

### 8.3) Caching Strategy

```python
from functools import lru_cache
import redis

redis_client = redis.Redis()

# Memory cache for immutable data
@lru_cache(maxsize=1000)
def get_user_permissions(user_id: str) -> List[str]:
    return fetch_from_db(user_id)

# Redis cache for shared data
async def get_project_cached(project_id: str) -> Project:
    # Check cache
    cached = await redis_client.get(f"project:{project_id}")
    if cached:
        return Project.parse_raw(cached)
    
    # Fetch from DB
    project = await get_project_from_db(project_id)
    
    # Cache with TTL
    await redis_client.setex(
        f"project:{project_id}",
        3600,  # 1 hour TTL
        project.json()
    )
    
    return project

# Cache invalidation
async def update_project(project_id: str, data: dict):
    # Update DB
    await update_project_in_db(project_id, data)
    
    # Invalidate cache
    await redis_client.delete(f"project:{project_id}")
```

## 9) Configuration Management

### 9.1) Environment-Based Config

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

### 9.2) Feature Flags

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

## 10) Error Handling

### 10.1) Error Hierarchy

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

### 10.2) Error Recovery

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

## 11) Checklists

### Database Checklist
- [ ] Schema follows naming conventions
- [ ] All tables have audit columns
- [ ] Foreign keys are indexed
- [ ] Constraints have descriptive names
- [ ] Soft delete strategy decided
- [ ] RLS policies configured (if using Supabase)
- [ ] Migrations are reversible
- [ ] Test data seeders created

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

### Performance Checklist
- [ ] Database queries optimized
- [ ] N+1 queries eliminated
- [ ] Connection pooling configured
- [ ] Caching strategy implemented
- [ ] Pagination on all lists
- [ ] Async processing for heavy operations
- [ ] CDN for static assets
- [ ] Database indexes reviewed